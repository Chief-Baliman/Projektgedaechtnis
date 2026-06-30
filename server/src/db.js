import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const dataDir = process.env.DATA_DIR || './data';
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'developer-hub.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  full_name TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  note TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rollbacks (
  repo_full_name TEXT PRIMARY KEY,
  branch TEXT NOT NULL,
  sha TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
    .run(key, JSON.stringify(value), new Date().toISOString());
}

export function saveProject(fullName, data) {
  db.prepare('INSERT INTO projects (full_name, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(full_name) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at')
    .run(fullName, JSON.stringify(data), new Date().toISOString());
}

export function listProjects() {
  return db.prepare('SELECT full_name, data, updated_at FROM projects ORDER BY updated_at DESC').all()
    .map(row => ({ fullName: row.full_name, updatedAt: row.updated_at, ...JSON.parse(row.data) }));
}

export function getProject(fullName) {
  const row = db.prepare('SELECT data FROM projects WHERE full_name = ?').get(fullName);
  return row ? JSON.parse(row.data) : null;
}
