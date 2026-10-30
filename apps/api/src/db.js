'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPass } = require('./auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'kusum.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS staff_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff'
);
CREATE TABLE IF NOT EXISTS guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL, pass_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, age INTEGER, gender TEXT,
  bed_code TEXT NOT NULL UNIQUE, diagnosis TEXT,
  guardian_name TEXT NOT NULL, guardian_phone TEXT NOT NULL, guardian_relation TEXT,
  linking_code TEXT NOT NULL UNIQUE, camera_id TEXT NOT NULL DEFAULT 'room_1',
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS bboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patients(id),
  camera_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
  label TEXT, created_by INTEGER, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guardian_id INTEGER NOT NULL REFERENCES guardians(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  submitted TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS patient_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guardian_id INTEGER NOT NULL REFERENCES guardians(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  bbox_id INTEGER NOT NULL REFERENCES bboxes(id),
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT
);
`);

const now = () => new Date().toISOString();
const audit = (actor, action, detail = '') =>
  db.prepare('INSERT INTO audit_logs (ts, actor, action, detail) VALUES (?, ?, ?, ?)')
    .run(now(), actor, action, detail);

// First-boot seed: one hospital admin + one demo patient (matches README walkthrough).
if (db.prepare('SELECT COUNT(*) c FROM staff_users').get().c === 0) {
  db.prepare('INSERT INTO staff_users (name, email, pass_hash, role) VALUES (?, ?, ?, ?)')
    .run('Head Nurse', 'admin@hospital.test', hashPass('admin123'), 'admin');
  db.prepare(`INSERT INTO patients
      (name, age, gender, bed_code, diagnosis, guardian_name, guardian_phone, guardian_relation, linking_code, camera_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('Rahul Sharma', 34, 'male', 'W-101', 'Post-surgery observation',
      'Sunita Sharma', '9876543210', 'wife', 'KSM-DEMO01', 'room_1');
  audit('system', 'seed', 'admin user + demo patient created');
  console.log('[db] seeded admin@hospital.test / admin123 and demo patient (code KSM-DEMO01)');
}

module.exports = { db, audit, now };
