import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { encryptText, decryptText, hashText } from './cryptoBox.js';

const dbPath = path.join(DATA_DIR, 'db.json');
const auditPath = path.join(DATA_DIR, 'audit.log');

const initialDb = {
  version: 8,
  settings: {},
  secrets: {},
  projects: {},
  scans: {},
  rollbacks: {},
  notes: {},
  resources: {},
  updatedAt: null
};

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(initialDb, null, 2));
  }
}

function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    return { ...initialDb, ...JSON.parse(raw) };
  } catch (e) {
    const backup = `${dbPath}.broken-${Date.now()}`;
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, backup);
    fs.writeFileSync(dbPath, JSON.stringify(initialDb, null, 2));
    return structuredClone(initialDb);
  }
}

function writeDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db.updatedAt = new Date().toISOString();
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbPath);
}

export function audit(action, payload = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(auditPath, JSON.stringify({ at: new Date().toISOString(), action, payload }) + '\n');
}

export function saveGithubToken(token) {
  const db = readDb();
  db.settings.githubToken = encryptText(token);
  db.settings.githubTokenHint = token ? `${token.slice(0, 4)}…${token.slice(-4)}` : '';
  db.settings.githubTokenHash = token ? hashText(token).slice(0, 16) : '';
  writeDb(db);
  audit('github_token_saved', { hint: db.settings.githubTokenHint });
}

export function getGithubToken() {
  const db = readDb();
  return decryptText(db.settings.githubToken || '');
}

export function getSecretValue(name) {
  const db = readDb();
  const item = db.secrets?.[name];
  if (!item) return '';
  return decryptText(item.value || '');
}

export function hasSecret(name) {
  const db = readDb();
  return Boolean(db.secrets?.[name]);
}

export function getSettingsSafe() {
  const db = readDb();
  return {
    hasGithubToken: Boolean(db.settings.githubToken),
    githubTokenHint: db.settings.githubTokenHint || '',
    aiProvider: db.settings.aiProvider || 'gemini',
    aiModels: db.settings.aiModels || {},
    aiKeys: {
      openai: Boolean(db.secrets?.AI_KEY_OPENAI || db.secrets?.OPENAI_API_KEY),
      gemini: Boolean(db.secrets?.AI_KEY_GEMINI),
      groq: Boolean(db.secrets?.AI_KEY_GROQ),
      openrouter: Boolean(db.secrets?.AI_KEY_OPENROUTER),
      mistral: Boolean(db.secrets?.AI_KEY_MISTRAL)
    },
    hasOpenAiKey: Boolean(db.secrets?.AI_KEY_OPENAI || db.secrets?.OPENAI_API_KEY),
    updatedAt: db.updatedAt
  };
}


export function getAiSettings() {
  const db = readDb();
  return {
    provider: db.settings.aiProvider || 'gemini',
    models: db.settings.aiModels || {}
  };
}

export function saveAiSettings(provider, model) {
  const db = readDb();
  const p = String(provider || 'gemini').trim().toLowerCase();
  db.settings.aiProvider = p;
  db.settings.aiModels = db.settings.aiModels || {};
  if (model) db.settings.aiModels[p] = String(model).trim();
  writeDb(db);
  audit('ai_settings_saved', { provider: p, model: db.settings.aiModels[p] || '' });
}

export function saveScan(fullName, analysis) {
  const db = readDb();
  db.scans[fullName] = analysis;
  db.projects[fullName] = {
    ...(db.projects[fullName] || {}),
    fullName,
    name: fullName.split('/').pop(),
    group: analysis.projectGroup || db.projects[fullName]?.group || 'unsortiert',
    purpose: analysis.purpose?.text || '',
    confidence: analysis.purpose?.confidence || 0,
    lastScannedAt: analysis.scannedAt,
    scannerVersion: analysis.scannerVersion,
    resources: analysis.resources || []
  };
  indexResources(db, fullName, analysis);
  writeDb(db);
  audit('scan_saved', { repo: fullName, scannerVersion: analysis.scannerVersion });
}

function indexResources(db, fullName, analysis) {
  const items = analysis.resources || [];
  for (const res of items) {
    const key = `${res.type}:${res.value}`;
    if (!db.resources[key]) db.resources[key] = { ...res, projects: [] };
    if (!db.resources[key].projects.includes(fullName)) db.resources[key].projects.push(fullName);
  }
}

export function getScan(fullName) {
  const db = readDb();
  return db.scans[fullName] || null;
}

export function getAllProjects() {
  const db = readDb();
  return Object.values(db.projects || {}).sort((a,b) => String(a.fullName).localeCompare(String(b.fullName)));
}

export function getResourceGraph() {
  const db = readDb();
  return Object.values(db.resources || {}).sort((a,b) => String(a.type + a.value).localeCompare(String(b.type + b.value)));
}

export function setProjectGroup(fullName, group) {
  const db = readDb();
  db.projects[fullName] = { ...(db.projects[fullName] || { fullName }), group };
  if (db.scans[fullName]) db.scans[fullName].projectGroup = group;
  writeDb(db);
  audit('project_group_set', { repo: fullName, group });
}

export function saveNote(fullName, note) {
  const db = readDb();
  db.notes[fullName] = { text: String(note || ''), updatedAt: new Date().toISOString() };
  writeDb(db);
  audit('note_saved', { repo: fullName });
}

export function getNote(fullName) {
  const db = readDb();
  return db.notes[fullName] || { text: '' };
}

export function saveSecret(name, value, meta = {}) {
  const db = readDb();
  db.secrets[name] = {
    name,
    value: encryptText(value),
    meta,
    hint: value ? `${String(value).slice(0, 3)}…${String(value).slice(-3)}` : '',
    updatedAt: new Date().toISOString()
  };
  writeDb(db);
  audit('secret_saved', { name });
}

export function listSecrets() {
  const db = readDb();
  return Object.values(db.secrets || {}).map(s => ({ name: s.name, hint: s.hint, meta: s.meta, updatedAt: s.updatedAt }));
}

export function revealSecret(name) {
  const db = readDb();
  const item = db.secrets?.[name];
  if (!item) return null;
  audit('secret_revealed', { name });
  return { name, value: decryptText(item.value || '') };
}

export function saveRollback(fullName, rollback) {
  const db = readDb();
  db.rollbacks[fullName] = { ...rollback, savedAt: new Date().toISOString() };
  writeDb(db);
  audit('rollback_saved', { repo: fullName, sha: rollback.sha });
}

export function getRollback(fullName) {
  const db = readDb();
  return db.rollbacks[fullName] || null;
}

export function exportData() {
  const db = readDb();
  const copy = structuredClone(db);
  if (copy.settings?.githubToken) copy.settings.githubToken = '[encrypted]';
  for (const item of Object.values(copy.secrets || {})) item.value = '[encrypted]';
  return copy;
}
