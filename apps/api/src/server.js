'use strict';
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { db, audit } = require('./db');
const { MEDIA_SECRET, hashPass, verifyPass, signSession, signMedia, verify } = require('./auth');

const app = Fastify({ logger: { level: 'warn' } });
app.register(cors, { origin: true });

// ---------- helpers ----------
const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const normPhone = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const nowISO = () => new Date().toISOString();

function session(req) {
  const h = req.headers.authorization || '';
  const data = verify(h.startsWith('Bearer ') ? h.slice(7) : null);
  return data && !data.m ? data : null; // sessions only; media tokens handled by /media/auth
}
function guard(req, reply, role) {
  const s = session(req);
  if (!s || (role && s.t !== role)) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return s;
}
function getUser(t, id) {
  return t === 'staff'
    ? db.prepare('SELECT id, name, email, role FROM staff_users WHERE id = ?').get(id)
    : db.prepare('SELECT id, name, email, phone FROM guardians WHERE id = ?').get(id);
}

// ---------- auth ----------
app.post('/auth/login', async (req, reply) => {
  const { email, pass } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  const staff = db.prepare('SELECT * FROM staff_users WHERE lower(email) = ?').get(e);
  if (staff && verifyPass(pass || '', staff.pass_hash)) {
    audit(`staff:${staff.id}`, 'login');
    return { token: signSession('staff', staff.id), role: staff.role, name: staff.name };
  }
  const g = db.prepare('SELECT * FROM guardians WHERE lower(email) = ?').get(e);
  if (g && verifyPass(pass || '', g.pass_hash)) {
    audit(`guardian:${g.id}`, 'login');
    return { token: signSession('guardian', g.id), role: 'guardian', name: g.name };
  }
  reply.code(401).send({ error: 'invalid email or password' });
});

app.post('/auth/register', async (req, reply) => {
  const { name, email, phone, pass } = req.body || {};
  if (!name || !email || !pass) return reply.code(400).send({ error: 'name, email, pass required' });
  const e = String(email).trim().toLowerCase();
  if (db.prepare('SELECT id FROM guardians WHERE lower(email)=?').get(e))
    return reply.code(409).send({ error: 'email already registered' });
  const r = db.prepare('INSERT INTO guardians (name, email, phone, pass_hash) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), e, normPhone(phone), hashPass(pass));
  audit(`guardian:${r.lastInsertRowid}`, 'registered', e);
  return { token: signSession('guardian', r.lastInsertRowid), role: 'guardian', name };
});

app.get('/me', async (req, reply) => {
  const s = guard(req, reply);
  if (!s) return;
  const u = getUser(s.t, s.id);
  if (!u) return reply.code(401).send({ error: 'unauthorized' });
  return { role: s.t, ...u };
});

// ---------- patients (staff) ----------
app.get('/patients', async (req, reply) => {
  if (!guard(req, reply, 'staff')) return;
  return {
    patients: db.prepare(`
      SELECT p.*, b.id bbox_id, b.x bbox_x, b.y bbox_y, b.w bbox_w, b.h bbox_h
      FROM patients p LEFT JOIN bboxes b ON b.patient_id = p.id AND b.active = 1
      ORDER BY p.id`).all(),
  };
});

app.post('/patients', async (req, reply) => {
  const s = guard(req, reply, 'staff');
  if (!s) return;
  const { name, age, gender, bed_code, diagnosis, guardian_name, guardian_phone, guardian_relation, camera_id } = req.body || {};
  if (!name || !bed_code || !guardian_name || !guardian_phone)
    return reply.code(400).send({ error: 'name, bed_code, guardian_name, guardian_phone required' });
  const code = 'KSM-' + Array.from({ length: 6 }, () =>
    'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
  try {
    const r = db.prepare(`INSERT INTO patients
      (name, age, gender, bed_code, diagnosis, guardian_name, guardian_phone, guardian_relation, linking_code, camera_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(String(name).trim(), age || null, gender || null, String(bed_code).trim().toUpperCase(),
        diagnosis || null, String(guardian_name).trim(), normPhone(guardian_phone),
        guardian_relation || null, code, camera_id || 'room_1');
    audit(`staff:${s.id}`, 'patient_created', `#${r.lastInsertRowid} ${name} bed ${bed_code}`);
    return { id: r.lastInsertRowid, linking_code: code };
  } catch (err) {
    return reply.code(409).send({ error: 'bed_code already exists' });
  }
});

app.patch('/patients/:id', async (req, reply) => {
  const s = guard(req, reply, 'staff');
  if (!s) return;
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!p) return reply.code(404).send({ error: 'not found' });
  const f = req.body || {};
  db.prepare(`UPDATE patients SET name=?, age=?, gender=?, diagnosis=?, guardian_name=?,
      guardian_phone=?, guardian_relation=?, camera_id=?, status=? WHERE id=?`)
    .run(f.name ?? p.name, f.age ?? p.age, f.gender ?? p.gender, f.diagnosis ?? p.diagnosis,
      f.guardian_name ?? p.guardian_name, f.guardian_phone ? normPhone(f.guardian_phone) : p.guardian_phone,
      f.guardian_relation ?? p.guardian_relation, f.camera_id ?? p.camera_id,
      f.status ?? p.status, p.id);
  audit(`staff:${s.id}`, 'patient_updated', `#${p.id}`);
  return { ok: true };
});

// ---------- staff assigns/updates the bounding box a guardian will see ----------
app.post('/patients/:id/bbox', async (req, reply) => {
  const s = guard(req, reply, 'staff');
  if (!s) return;
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!p) return reply.code(404).send({ error: 'not found' });
  const { x, y, w, h } = req.body?.bbox || {};
  if (![x, y, w, h].every((v) => typeof v === 'number' && v >= 0 && v <= 1))
    return reply.code(400).send({ error: 'bbox {x,y,w,h} normalized 0..1 required' });
  db.prepare('UPDATE bboxes SET active = 0 WHERE patient_id = ?').run(p.id);
  const r = db.prepare(`INSERT INTO bboxes (patient_id, camera_id, x, y, w, h, label, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, p.camera_id, x, y, w, h, `${p.bed_code} bed`, s.id);
  // re-point any ACTIVE guardian access to the new box; the worker re-crops within ~5s
  db.prepare('UPDATE patient_access SET bbox_id = ? WHERE patient_id = ? AND status = ?')
    .run(r.lastInsertRowid, p.id, 'active');
  audit(`staff:${s.id}`, 'bbox_assigned', `patient #${p.id} (${p.bed_code}) -> guardian ${p.guardian_name} bbox ${JSON.stringify({ x, y, w, h })}`);
  return { ok: true, bbox_id: r.lastInsertRowid };
});

// ---------- guardian onboarding: submit access request ----------
app.post('/onboard', async (req, reply) => {
  const s = guard(req, reply, 'guardian');
  if (!s) return;
  const { linking_code, patient_name, guardian_name, guardian_phone } = req.body || {};
  const p = db.prepare('SELECT * FROM patients WHERE UPPER(linking_code) = UPPER(?)')
    .get(String(linking_code || '').trim());
  if (!p) return reply.code(404).send({ error: 'unknown linking code' });

  const failed = [];
  if (normName(patient_name) !== normName(p.name)) failed.push('patient_name');
  if (normName(guardian_name) !== normName(p.guardian_name)) failed.push('guardian_name');
  if (normPhone(guardian_phone) !== normPhone(p.guardian_phone)) failed.push('guardian_phone');
  if (failed.length)
    return reply.code(422).send({ error: 'details do not match hospital records', failed });

  const dup = db.prepare(`SELECT id FROM access_requests WHERE guardian_id=? AND patient_id=? AND status='pending'`)
    .get(s.id, p.id);
  if (dup) return reply.code(409).send({ error: 'request already pending' });

  const submitted = JSON.stringify({ patient_name, guardian_name, guardian_phone });
  const r = db.prepare(`INSERT INTO access_requests (guardian_id, patient_id, submitted, created_at)
    VALUES (?, ?, ?, ?)`).run(s.id, p.id, submitted, nowISO());
  audit(`guardian:${s.id}`, 'access_request_created', `patient #${p.id} request #${r.lastInsertRowid}`);
  return { ok: true, request_id: r.lastInsertRowid, patient: p.name };
});

app.get('/me/requests', async (req, reply) => {
  const s = guard(req, reply, 'guardian');
  if (!s) return;
  return { requests: db.prepare(`
    SELECT ar.id, ar.status, ar.created_at, ar.decided_at, p.name patient_name, p.bed_code
    FROM access_requests ar JOIN patients p ON p.id = ar.patient_id
    WHERE ar.guardian_id = ? ORDER BY ar.id DESC LIMIT 20`).all(s.id) };
});

// ---------- access requests (staff review) ----------
app.get('/requests', async (req, reply) => {
  if (!guard(req, reply, 'staff')) return;
  const status = req.query.status || 'pending';
  return { requests: db.prepare(`
    SELECT ar.*, g.name guardian_account_name, g.email guardian_email, g.phone guardian_phone,
           p.name patient_name, p.age, p.gender, p.bed_code, p.guardian_name rec_guardian_name,
           p.guardian_phone rec_guardian_phone, p.camera_id
    FROM access_requests ar
    JOIN guardians g ON g.id = ar.guardian_id
    JOIN patients p ON p.id = ar.patient_id
    WHERE ar.status = ? ORDER BY ar.id DESC`).all(status) };
});

app.post('/requests/:id/approve', async (req, reply) => {
  const s = guard(req, reply, 'staff');
  if (!s) return;
  const ar = db.prepare('SELECT * FROM access_requests WHERE id = ? AND status = ?').get(req.params.id, 'pending');
  if (!ar) return reply.code(404).send({ error: 'pending request not found' });
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(ar.patient_id);
  const { x, y, w, h } = req.body?.bbox || {};
  if (![x, y, w, h].every((v) => typeof v === 'number' && v >= 0 && v <= 1))
    return reply.code(400).send({ error: 'bbox {x,y,w,h} normalized 0..1 required' });

  db.prepare('UPDATE bboxes SET active = 0 WHERE patient_id = ?').run(p.id);
  const bbox = db.prepare(`INSERT INTO bboxes (patient_id, camera_id, x, y, w, h, label, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, p.camera_id, x, y, w, h, `${p.bed_code} bed`, s.id);
  db.prepare('UPDATE access_requests SET status=?, reviewed_by=?, decided_at=? WHERE id=?')
    .run('approved', s.id, nowISO(), ar.id);
  db.prepare(`UPDATE patient_access SET status='revoked', revoked_at=? WHERE guardian_id=? AND status='active'`)
    .run(nowISO(), ar.guardian_id);
  db.prepare(`INSERT INTO patient_access (guardian_id, patient_id, bbox_id, created_at)
    VALUES (?, ?, ?, ?)`).run(ar.guardian_id, p.id, bbox.lastInsertRowid, nowISO());
  audit(`staff:${s.id}`, 'request_approved', `request #${ar.id} patient #${p.id} guardian #${ar.guardian_id} bbox ${JSON.stringify({ x, y, w, h })}`);
  return { ok: true };
});

app.post('/requests/:id/reject', async (req, reply) => {
  const s = guard(req, reply, 'staff');
  if (!s) return;
  const r = db.prepare(`UPDATE access_requests SET status='rejected', reviewed_by=?, decided_at=?
    WHERE id=? AND status='pending'`).run(s.id, nowISO(), req.params.id);
  if (!r.changes) return reply.code(404).send({ error: 'pending request not found' });
  audit(`staff:${s.id}`, 'request_rejected', `request #${req.params.id}`);
  return { ok: true };
});

// ---------- views ----------
app.get('/streams', async (req, reply) => {
  if (!guard(req, reply, 'staff')) return;
  const cams = db.prepare(`SELECT DISTINCT camera_id FROM patients WHERE status='active'`).all();
  const patients = db.prepare(`
    SELECT p.id, p.name, p.bed_code, p.camera_id, b.x, b.y, b.w, b.h
    FROM patients p JOIN bboxes b ON b.patient_id = p.id AND b.active = 1`).all();
  return { cameras: cams.map((c) => c.camera_id), patients };
});

app.get('/me/access', async (req, reply) => {
  const s = guard(req, reply, 'guardian');
  if (!s) return;
  const a = db.prepare(`
    SELECT p.id patient_id, p.name patient_name, p.bed_code, b.x, b.y, b.w, b.h
    FROM patient_access pa JOIN patients p ON p.id = pa.patient_id
    JOIN bboxes b ON b.id = pa.bbox_id
    WHERE pa.guardian_id = ? AND pa.status = 'active'`).get(s.id);
  if (!a) return { access: null };
  return { access: { stream: `patient_${a.patient_id}`, bbox: { x: a.x, y: a.y, w: a.w, h: a.h },
    patient: { id: a.patient_id, name: a.patient_name, bed_code: a.bed_code } } };
});

// ---------- media tokens + MediaMTX auth hook ----------
const READABLE = /^(room_\w+_blurred|patient_\d+)$/;
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:5600';

// YOLO bed suggestions from the vision worker's latest raw frame (staff clicks one
// to assign a patient's strict bounding box; every bed is returned, not just one).
app.get('/detect-beds', async (req, reply) => {
  if (!guard(req, reply, 'staff')) return;
  const camera = String(req.query.camera || 'room_1');
  try {
    const r = await fetch(`${WORKER_URL}/beds?camera=${encodeURIComponent(camera)}&secret=${encodeURIComponent(MEDIA_SECRET)}`);
    if (!r.ok) throw new Error(`worker HTTP ${r.status}`);
    return await r.json();
  } catch {
    return reply.code(502).send({ error: 'vision worker unavailable (is worker.py running?)' });
  }
});

app.get('/media/token', async (req, reply) => {
  const s = guard(req, reply);
  if (!s) return;
  const path = String(req.query.path || '');
  if (!READABLE.test(path)) return reply.code(400).send({ error: 'bad path' });
  if (s.t === 'guardian') {
    const a = db.prepare(`SELECT pa.patient_id FROM patient_access pa
      WHERE pa.guardian_id=? AND pa.status='active'`).get(s.id);
    if (!a || path !== `patient_${a.patient_id}`)
      return reply.code(403).send({ error: 'no active access for this stream' });
  }
  return { token: signMedia(path, s.id, s.t) };
});

// Called by MediaMTX for every publish/read. Allow = 2xx, deny = 401/403.
app.post('/media/auth', async (req, reply) => {
  const { action, path = '', query = '', user, pass, ip } = req.body || {};
  if (action === 'publish') {
    // Only the camera simulator + vision worker, carrying the shared secret.
    return user === 'publish' && pass === MEDIA_SECRET ? reply.code(200).send() : reply.code(403).send();
  }
  if (action === 'read') {
    const d = verify(new URLSearchParams(query).get('token'));
    if (!d || !d.m || d.p !== path || !READABLE.test(path)) return reply.code(403).send();
    if (d.r === 'guardian') {
      // Fresh DB check on every playback start -> revocation applies immediately.
      const a = db.prepare(`SELECT patient_id FROM patient_access WHERE guardian_id=? AND status='active'`).get(d.u);
      if (!a || path !== `patient_${a.patient_id}`) return reply.code(403).send();
    }
    return reply.code(200).send();
  }
  // api/metrics/pprof: local machine only
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return local ? reply.code(200).send() : reply.code(403).send();
});

// ---------- internal (vision worker) ----------
function internal(req, reply) {
  if (req.headers['x-internal-secret'] !== MEDIA_SECRET) {
    reply.code(403).send({ error: 'forbidden' });
    return false;
  }
  return true;
}
app.get('/internal/cameras', async (req, reply) => {
  if (!internal(req, reply)) return;
  return { cameras: db.prepare(`SELECT DISTINCT camera_id FROM patients WHERE status='active'`).all()
    .map((c) => c.camera_id) };
});
app.get('/internal/crops', async (req, reply) => {
  if (!internal(req, reply)) return;
  const rows = db.prepare(`
    SELECT p.id, p.camera_id, b.x, b.y, b.w, b.h
    FROM patient_access pa JOIN patients p ON p.id = pa.patient_id
    JOIN bboxes b ON b.id = pa.bbox_id
    WHERE pa.status = 'active'`).all();
  return { crops: rows.map((r) => ({
    stream: `patient_${r.id}`, camera_id: r.camera_id,
    bbox: { x: r.x, y: r.y, w: r.w, h: r.h } })) };
});

// ---------- audit + health ----------
app.get('/audit', async (req, reply) => {
  if (!guard(req, reply, 'staff')) return;
  return { logs: db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all() };
});
app.get('/health', async () => ({ ok: true, ts: nowISO() }));

app.listen({ port: process.env.PORT || 3001, host: '::' }) // dual-stack: IPv4 + IPv6
  .then(() => console.log('[api] listening on http://localhost:3001'))
  .catch((err) => { console.error(err); process.exit(1); });
