'use strict';
const crypto = require('node:crypto');

const MEDIA_SECRET = process.env.MEDIA_SECRET || 'devmedia';
const SESSION_TTL = 12 * 3600; // 12h
const MEDIA_TTL = 120;         // media tokens are short-lived by design

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', MEDIA_SECRET).update(data).digest('base64url');

// ---- passwords (scrypt, no native deps) ----
function hashPass(pw) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function verifyPass(pw, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const calc = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(calc, Buffer.from(key, 'hex'));
}

// ---- signed tokens (HMAC; same format for sessions and media grants) ----
function sign(payload, ttl) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttl }));
  return `${body}.${hmac(body)}`;
}
function verify(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const check = hmac(body);
  if (check.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(check), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Math.floor(Date.now() / 1000) ? data : null;
  } catch { return null; }
}
const signSession = (t, id) => sign({ t, id }, SESSION_TTL);
const signMedia = (p, u, r) => sign({ p, u, r, m: 1 }, MEDIA_TTL);

module.exports = { MEDIA_SECRET, hashPass, verifyPass, signSession, signMedia, verify };
