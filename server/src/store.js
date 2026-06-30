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
  firebaseDocs: {},
  serverDocs: {},
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


function normalizeList(value) {
  if (Array.isArray(value)) return value.map(x => String(x).trim()).filter(Boolean);
  return String(value || '').split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
}

function parseFirebaseRulesText(text) {
  const raw = String(text || '').trim();
  const result = { format: raw ? 'text' : 'empty', paths: [], readWrite: [], warnings: [] };
  if (!raw) return result;
  try {
    const json = JSON.parse(raw);
    result.format = 'json';
    const rules = json.rules || json;
    const walk = (node, prefix = '') => {
      if (!node || typeof node !== 'object') return;
      const entry = { path: prefix || '/', read: null, write: null, validate: null, indexOn: null };
      let hasRule = false;
      for (const [key, value] of Object.entries(node)) {
        if (key === '.read') { entry.read = String(value); hasRule = true; }
        else if (key === '.write') { entry.write = String(value); hasRule = true; }
        else if (key === '.validate') { entry.validate = String(value); hasRule = true; }
        else if (key === '.indexOn') { entry.indexOn = Array.isArray(value) ? value.join(', ') : String(value); hasRule = true; }
      }
      if (prefix && !result.paths.includes(prefix)) result.paths.push(prefix);
      if (hasRule) result.readWrite.push(entry);
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('.')) continue;
        const next = prefix ? `${prefix}/${key}` : key;
        walk(value, next);
      }
    };
    walk(rules, '');
  } catch (e) {
    result.format = 'rules_or_text';
    const lines = raw.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const match = line.match(/match\s+\/([^\s{]+)/);
      if (match) result.paths.push(match[1]);
      const pathLike = line.match(/["']([A-Za-z0-9_$-]+(?:\/[A-Za-z0-9_$-]+)+)["']/);
      if (pathLike) result.paths.push(pathLike[1]);
      if (/allow\s+read|\.read|allow\s+write|\.write/.test(line)) {
        result.readWrite.push({ path: result.paths[result.paths.length - 1] || '/', line: idx + 1, rule: line.trim() });
      }
    });
    if (!result.paths.length) result.warnings.push('Keine Pfade automatisch erkannt. Regeln wurden als Freitext gespeichert.');
  }
  result.paths = [...new Set(result.paths)].slice(0, 500);
  result.readWrite = result.readWrite.slice(0, 500);
  return result;
}

export function saveServerDoc(key, doc) {
  const db = readDb();
  const safeKey = String(key || doc?.name || doc?.ip || `server-${Date.now()}`).trim();
  if (!safeKey) throw new Error('Server-Schlüssel fehlt.');
  db.serverDocs = db.serverDocs || {};
  db.serverDocs[safeKey] = {
    ...(db.serverDocs[safeKey] || {}),
    key: safeKey,
    name: String(doc?.name || '').trim(),
    provider: String(doc?.provider || '').trim(),
    ip: String(doc?.ip || '').trim(),
    domain: String(doc?.domain || '').trim(),
    sshUser: String(doc?.sshUser || '').trim(),
    sshPort: String(doc?.sshPort || '').trim(),
    os: String(doc?.os || '').trim(),
    role: String(doc?.role || '').trim(),
    notes: String(doc?.notes || '').trim(),
    projectPaths: normalizeList(doc?.projectPaths),
    services: normalizeList(doc?.services),
    updatedAt: new Date().toISOString()
  };
  writeDb(db);
  audit('server_doc_saved', { key: safeKey });
}

export function getServerDocs() {
  const db = readDb();
  return Object.values(db.serverDocs || {}).sort((a,b) => String(a.key).localeCompare(String(b.key)));
}

export function buildServerContext(inventory = null) {
  const docs = getServerDocs();
  const lines = ['# Server / VPS Kontext'];
  if (inventory) {
    lines.push(`Host: ${inventory.host || 'unbekannt'}`);
    if (inventory.publicIp || inventory.ips?.length) lines.push(`IP: ${inventory.publicIp || inventory.ips.join(', ')}`);
    lines.push(`Services: ${(inventory.services || []).map(s => `${s.unit}(${s.active})`).join(', ') || 'keine'}`);
    lines.push(`Opt-Projekte: ${(inventory.optProjects || []).map(p => p.path).join(', ') || 'keine'}`);
  }
  for (const d of docs) {
    lines.push(`\n## ${d.name || d.key}`);
    lines.push(`Provider/IP: ${d.provider || '-'} / ${d.ip || '-'}`);
    lines.push(`Domain: ${d.domain || '-'}`);
    lines.push(`SSH: ${d.sshUser || 'root'}@${d.ip || '<ip>'}${d.sshPort ? ':' + d.sshPort : ''}`);
    if (d.projectPaths?.length) lines.push(`Projektpfade: ${d.projectPaths.join(', ')}`);
    if (d.services?.length) lines.push(`Services: ${d.services.join(', ')}`);
    if (d.notes) lines.push(`Hinweise: ${d.notes}`);
  }
  return lines.join('\n');
}

export function saveFirebaseDoc(key, doc) {
  const db = readDb();
  const safeKey = String(key || doc?.projectId || doc?.databaseUrl || `firebase-${Date.now()}`).trim();
  if (!safeKey) throw new Error('Firebase-Schlüssel fehlt.');
  db.firebaseDocs = db.firebaseDocs || {};
  const rulesText = String(doc?.rulesText ?? doc?.rules ?? db.firebaseDocs[safeKey]?.rulesText ?? '').trim();
  const parsedRules = parseFirebaseRulesText(rulesText);
  db.firebaseDocs[safeKey] = {
    ...(db.firebaseDocs[safeKey] || {}),
    key: safeKey,
    label: String(doc?.label || '').trim(),
    projectId: String(doc?.projectId || '').trim(),
    databaseUrl: String(doc?.databaseUrl || '').trim(),
    authDomain: String(doc?.authDomain || '').trim(),
    storageBucket: String(doc?.storageBucket || '').trim(),
    ownerAccount: String(doc?.ownerAccount || '').trim(),
    firebaseUsers: normalizeList(doc?.firebaseUsers),
    consoleUrl: String(doc?.consoleUrl || '').trim(),
    notes: String(doc?.notes || '').trim(),
    rulesText,
    parsedRules,
    updatedAt: new Date().toISOString()
  };
  writeDb(db);
  audit('firebase_doc_saved', { key: safeKey, paths: parsedRules.paths.length });
}

export function getFirebaseDocs() {
  const db = readDb();
  return Object.values(db.firebaseDocs || {}).sort((a,b) => String(a.key).localeCompare(String(b.key)));
}

export function getFirebaseRulesLibrary() {
  const docs = getFirebaseDocs();
  const rows = [];
  for (const d of docs) {
    for (const path of d.parsedRules?.paths || []) {
      const matchingRules = (d.parsedRules?.readWrite || []).filter(r => r.path === path || String(r.path || '').startsWith(path));
      rows.push({ key: d.key, label: d.label, projectId: d.projectId, databaseUrl: d.databaseUrl, path, rules: matchingRules });
    }
  }
  return rows.sort((a,b) => String(a.key + a.path).localeCompare(String(b.key + b.path)));
}

export function buildFirebaseContext() {
  const docs = getFirebaseDocs();
  const aggregate = getFirebaseAggregate();
  const lines = ['# Firebase Kontext'];
  for (const d of docs) {
    lines.push(`\n## ${d.label || d.key}`);
    lines.push(`Projekt-ID: ${d.projectId || '-'}`);
    lines.push(`Database URL: ${d.databaseUrl || '-'}`);
    lines.push(`Firebase Account/User: ${d.ownerAccount || '-'}${d.firebaseUsers?.length ? ' / ' + d.firebaseUsers.join(', ') : ''}`);
    lines.push(`Console: ${d.consoleUrl || '-'}`);
    if (d.parsedRules?.paths?.length) lines.push(`Rules-Pfade: ${d.parsedRules.paths.join(', ')}`);
    if (d.notes) lines.push(`Hinweise: ${d.notes}`);
  }
  if (aggregate.resources?.length) {
    lines.push('\n## Aus Repository-Scans erkannte Firebase-Ressourcen');
    for (const r of aggregate.resources.slice(0, 80)) lines.push(`- ${r.type}: ${r.value} (${(r.projects||[]).join(', ')})`);
  }
  return lines.join('\n');
}

export function getFirebaseAggregate() {
  const db = readDb();
  const map = new Map();
  for (const [fullName, scan] of Object.entries(db.scans || {})) {
    for (const res of scan.resources || []) {
      if (!String(res.type || '').startsWith('firebase')) continue;
      const key = `${res.type}:${res.value}`;
      if (!map.has(key)) map.set(key, { type: res.type, value: res.value, label: res.label || res.type, projects: [], evidence: [] });
      const item = map.get(key);
      if (!item.projects.includes(fullName)) item.projects.push(fullName);
    }
    for (const fact of scan.facts || []) {
      if (!/firebase|realtime|firestore|database|rules/i.test(`${fact.kind} ${fact.reason} ${fact.snippet}`)) continue;
      const key = `fact:${fact.kind}:${fact.value || fact.snippet}`.slice(0, 180);
      if (!map.has(key)) map.set(key, { type: 'firebase-fact', value: fact.value || fact.snippet, label: fact.kind || 'Fact', projects: [], evidence: [] });
      const item = map.get(key);
      if (!item.projects.includes(fullName)) item.projects.push(fullName);
      item.evidence.push({ repo: fullName, file: fact.file, line: fact.line, snippet: fact.snippet });
    }
  }
  return { resources: Array.from(map.values()).sort((a,b) => String(a.type+a.value).localeCompare(String(b.type+b.value))), docs: getFirebaseDocs() };
}

export function exportData() {
  const db = readDb();
  const copy = structuredClone(db);
  if (copy.settings?.githubToken) copy.settings.githubToken = '[encrypted]';
  for (const item of Object.values(copy.secrets || {})) item.value = '[encrypted]';
  return copy;
}
