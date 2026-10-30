import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { playWhep } from './player.js';

const tokenFor = async (path) => (await api(`/media/token?path=${encodeURIComponent(path)}`)).token;

/* ---------- live video with optional bbox overlays ---------- */
function LiveVideo({ path, boxes = [], overlay, className = '' }) {
  const vRef = useRef(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let pc;
    setErr('');
    playWhep(vRef.current, path, tokenFor).then((p) => (pc = p)).catch((e) => setErr(e.message));
    return () => pc && pc.close();
  }, [path]);
  return (
    <div className={`video-wrap ${className}`}>
      <video ref={vRef} autoPlay muted playsInline />
      {overlay && boxes.map((b, i) => (
        <div key={i} className="bbox-overlay" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
          {b.label && <span>{b.label}</span>}
        </div>
      ))}
      {err && <div className="video-err">{err}</div>}
    </div>
  );
}

/* ---------- staff draws a bounding box over the live blurred room view ---------- */
function BboxEditor({ camera, onRect, suggestions = [] }) {
  const vRef = useRef(null);
  const cRef = useRef(null);
  const [rect, setRect] = useState(null);
  const drag = useRef(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let pc;
    setErr('');
    setRect(null);
    playWhep(vRef.current, `${camera}_blurred`, tokenFor).then((p) => (pc = p)).catch((e) => setErr(e.message));
    return () => pc && pc.close();
  }, [camera]);

  const pos = (e) => {
    const r = cRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const down = (e) => { drag.current = pos(e); setRect(null); };
  const move = (e) => {
    if (!drag.current) return;
    const p = pos(e);
    const r = { x: Math.min(drag.current.x, p.x), y: Math.min(drag.current.y, p.y),
      w: Math.abs(p.x - drag.current.x), h: Math.abs(p.y - drag.current.y) };
    setRect(r);
  };
  const up = () => {
    if (rect && rect.w > 0.02 && rect.h > 0.02) onRect(rect);
    drag.current = null;
  };

  return (
    <div className="video-wrap">
      <video ref={vRef} autoPlay muted playsInline />
      <canvas ref={cRef} className="bbox-canvas" onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} />
      {suggestions.map((b, i) => (
        <div key={i} className="bbox-suggest" title={`detected bed ${(b.conf * 100).toFixed(0)}% — click to use`}
          style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
          onClick={() => setRect({ x: b.x, y: b.y, w: b.w, h: b.h })} />
      ))}
      {rect && <div className="bbox-overlay" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />}
      {err && <div className="video-err">{err}</div>}
      <p className="hint">Click a blue auto-detected bed, or drag a rectangle manually, then press Approve.</p>
    </div>
  );
}

/* ---------- views ---------- */
function Login({ onLogin }) {
  const [email, setEmail] = useState('admin@hospital.test');
  const [pass, setPass] = useState('admin123');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, pass } });
      if (r.role !== 'staff' && r.role !== 'admin') return setErr('This dashboard is for hospital staff.');
      localStorage.setItem('token', r.token);
      onLogin(r);
    } catch (ex) { setErr(ex.message); }
  };
  return (
    <form className="card login" onSubmit={submit}>
      <h1>Kusum <small>Hospital Dashboard</small></h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff email" />
      <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="password" />
      {err && <p className="err">{err}</p>}
      <button>Sign in</button>
    </form>
  );
}

function Patients() {
  const [rows, setRows] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [lastCode, setLastCode] = useState('');
  const [form, setForm] = useState({ name: '', age: '', gender: 'male', bed_code: '', diagnosis: '', guardian_name: '', guardian_phone: '', guardian_relation: '', camera_id: 'room_1' });
  const load = useCallback(() => api('/patients').then((d) => setRows(d.patients)), []);
  useEffect(() => { load(); }, [load]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const create = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/patients', { method: 'POST', body: form });
      setLastCode(r.linking_code);
      setShowForm(false);
      load();
    } catch (ex) { alert(ex.message); }
  };
  const F = (k, ph, type = 'text') => <input required={k !== 'diagnosis'} type={type} placeholder={ph} value={form[k]} onChange={set(k)} />;
  return (
    <section>
      <div className="row"><h2>Patients</h2>
        <button onClick={() => setShowForm(!showForm)}>{showForm ? 'Close' : '+ Register patient'}</button></div>
      {lastCode && <div className="card ok">Patient registered. Linking code for the guardian: <b className="code">{lastCode}</b> — share it only with the verified guardian.</div>}
      {showForm && (
        <form className="card grid" onSubmit={create}>
          {F('name', 'patient full name')}{F('age', 'age', 'number')}{F('bed_code', 'bed / room code')}
          <select value={form.gender} onChange={set('gender')}><option>male</option><option>female</option><option>other</option></select>
          {F('camera_id', 'camera id (room_1)')}
          {F('diagnosis', 'condition / diagnosis')}{F('guardian_name', 'guardian full name')}{F('guardian_phone', 'guardian phone')}
          {F('guardian_relation', 'guardian relation (wife, son…)')}
          <button>Register</button>
        </form>
      )}
      <table>
        <thead><tr><th>Name</th><th>Bed</th><th>Guardian</th><th>Linking code</th><th>Camera</th><th>Bbox</th></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id}>
            <td>{p.name} ({p.age ?? '—'})</td><td>{p.bed_code}</td>
            <td>{p.guardian_name} · {p.guardian_relation || '—'} · {p.guardian_phone}</td>
            <td className="code">{p.linking_code}</td><td>{p.camera_id}</td>
            <td>{p.bbox_id ? '✅ assigned' : '—'}</td>
          </tr>))}
        </tbody>
      </table>
    </section>
  );
}

function Requests() {
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  const [rect, setRect] = useState(null);
  const [beds, setBeds] = useState([]);
  const [bedErr, setBedErr] = useState('');
  const load = useCallback(() => api('/requests?status=pending').then((d) => setRows(d.requests)), []);
  useEffect(() => { load(); }, [load]);
  const pick = (r) => {
    setSel(r); setRect(null); setBeds([]); setBedErr('');
    api(`/detect-beds?camera=${encodeURIComponent(r.camera_id)}`)
      .then((d) => setBeds(d.beds || []))
      .catch((e) => setBedErr(e.message));
  };
  const detect = () => sel && pick(sel);
  const decide = async (approve) => {
    try {
      if (approve) {
        if (!rect) return alert('Pick a detected bed or draw the bounding box first.');
        await api(`/requests/${sel.id}/approve`, { method: 'POST', body: { bbox: rect } });
      } else {
        await api(`/requests/${sel.id}/reject`, { method: 'POST' });
      }
      setSel(null);
      load();
    } catch (ex) { alert(ex.message); }
  };
  const s = sel && sel.submitted ? JSON.parse(sel.submitted) : null;
  return (
    <section>
      <h2>Guardian access requests</h2>
      {rows.length === 0 && <p className="hint">No pending requests.</p>}
      <table>
        <thead><tr><th>Guardian account</th><th>Patient</th><th>Submitted</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className={sel?.id === r.id ? 'sel' : ''} onClick={() => pick(r)}>
            <td>{r.guardian_account_name} · {r.guardian_email}</td><td>{r.patient_name} ({r.bed_code})</td>
            <td>{new Date(r.created_at).toLocaleString()}</td>
          </tr>))}
        </tbody>
      </table>
      {sel && s && (
        <div className="card">
          <h3>Verify request #{sel.id}</h3>
          <div className="verify">
            <div><h4>Guardian submitted</h4>
              <p>Patient: <b>{s.patient_name}</b></p><p>Guardian: <b>{s.guardian_name}</b></p><p>Phone: <b>{s.guardian_phone}</b></p>
              <p className="hint">Account: {sel.guardian_account_name} ({sel.guardian_email})</p></div>
            <div><h4>Hospital record</h4>
              <p>Patient: <b>{sel.patient_name}</b></p><p>Guardian: <b>{sel.rec_guardian_name}</b></p><p>Phone: <b>{sel.rec_guardian_phone}</b></p>
              <p className="hint">Bed: {sel.bed_code} · camera {sel.camera_id}</p></div>
          </div>
          <div className="row"><h4>Bounding box</h4><span className="spacer" />
            <button onClick={detect}>Re-detect beds (YOLO)</button></div>
          {bedErr && <p className="err">{bedErr}</p>}
          {!bedErr && beds.length > 0 && <p className="hint">{beds.length} bed(s) detected — click the right one.</p>}
          <BboxEditor camera={sel.camera_id} onRect={setRect} suggestions={beds} />
          <div className="row">
            <button className="danger" onClick={() => decide(false)}>Reject</button>
            <button className="okb" onClick={() => decide(true)}>Approve with drawn box</button>
          </div>
        </div>
      )}
    </section>
  );
}

function VideoBoxes() {
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  const [rect, setRect] = useState(null);
  const [beds, setBeds] = useState([]);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api('/patients').then((d) => setRows(d.patients)), []);
  useEffect(() => { load(); }, [load]);
  const pick = (p) => {
    setSel(p); setMsg('');
    setRect(p.bbox_id ? { x: p.bbox_x, y: p.bbox_y, w: p.bbox_w, h: p.bbox_h } : null);
    setBeds([]);
    api(`/detect-beds?camera=${encodeURIComponent(p.camera_id)}`)
      .then((d) => setBeds(d.beds || [])).catch(() => {});
  };
  const save = async () => {
    if (!rect) return alert('Click a detected bed or drag a box first.');
    try {
      await api(`/patients/${sel.id}/bbox`, { method: 'POST', body: { bbox: rect } });
      setMsg(`Saved. ${sel.guardian_name} (guardian of ${sel.name}, bed ${sel.bed_code}) will now see exactly this box — nothing outside it.`);
      load();
    } catch (ex) { alert(ex.message); }
  };
  return (
    <section>
      <h2>Video & bounding boxes</h2>
      <p className="hint">Select a patient, then click a blue auto-detected bed or drag a rectangle on the live blurred video. Saving updates what the guardian sees (crop stream switches within ~5 s).</p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {rows.map((p) => (
          <button key={p.id} className={sel?.id === p.id ? 'active' : 'ghost'} onClick={() => pick(p)}>
            {p.name} · {p.bed_code}{p.bbox_id ? ' ✅' : ''}
          </button>
        ))}
      </div>
      {sel && (
        <div className="card">
          <h3>{sel.name} (bed {sel.bed_code}) — guardian: {sel.guardian_name}</h3>
          {beds.length > 0 && <p className="hint">{beds.length} bed(s) auto-detected — click the right one.</p>}
          <BboxEditor camera={sel.camera_id} onRect={setRect} suggestions={beds} />
          <div className="row"><span className="hint">Box: {rect ? `${(rect.x * 100).toFixed(0)}%,${(rect.y * 100).toFixed(0)}% ${(rect.w * 100).toFixed(0)}×${(rect.h * 100).toFixed(0)}` : 'none yet'}</span>
            <span className="spacer" /><button className="okb" onClick={save}>Save box for guardian</button></div>
          {msg && <p className="ok-msg">{msg}</p>}
        </div>
      )}
    </section>
  );
}

function Live() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/streams').then(setData).catch((e) => alert(e.message)); }, []);
  if (!data) return <p className="hint">Loading…</p>;
  return (
    <section>
      <h2>Live ward view (privacy-blurred)</h2>
      <p className="hint">All frames pass the nudity-blur pipeline before leaving the server.</p>
      <div className="grid-cams">
        {data.cameras.map((cam) => (
          <div key={cam}>
            <h3>{cam}</h3>
            <LiveVideo path={`${cam}_blurred`} overlay
              boxes={data.patients.filter((p) => p.camera_id === cam)
                .map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, label: `${p.name} · ${p.bed_code}` }))} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Audit() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { api('/audit').then((d) => setLogs(d.logs)); }, []);  return (
    <section>
      <h2>Audit log</h2>
      <table>
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>{logs.map((l) => (
          <tr key={l.id}><td>{new Date(l.ts).toLocaleString()}</td><td>{l.actor}</td><td>{l.action}</td><td>{l.detail}</td></tr>))}
        </tbody>
      </table>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('patients');
  useEffect(() => {
    if (localStorage.getItem('token')) api('/me').then((u) => {
      if (u.role === 'guardian') return localStorage.clear();
      setUser(u);
    }).catch(() => {});
  }, []);
  if (!user) return <Login onLogin={(r) => { setUser(r); }} />;
  const tabs = [['patients', 'Patients'], ['requests', 'Requests'], ['video', 'Video & Boxes'], ['live', 'Live view'], ['audit', 'Audit']];
  return (
    <div className="app">
      <nav className="row">
        <b>Kusum</b>
        {tabs.map(([k, label]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>)}
        <span className="spacer" />
        <small>{user.name}</small>
        <button onClick={() => { localStorage.clear(); setUser(null); }}>Logout</button>
      </nav>
      {tab === 'patients' && <Patients />}
      {tab === 'requests' && <Requests />}
      {tab === 'video' && <VideoBoxes />}
      {tab === 'live' && <Live />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}
