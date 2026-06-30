import fs from 'fs';
import path from 'path';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'developer-hub.json');
const empty = { settings: {}, projects: {}, secrets: [], rollbacks: {}, audit: [] };
let data = empty;
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = structuredClone(empty); save(); }
function save() { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
export function now() { return new Date().toISOString(); }
export function getSetting(key) { return data.settings[key] || null; }
export function setSetting(key, value) { data.settings[key] = { ...value, updatedAt: now() }; save(); }
export function deleteSetting(key) { delete data.settings[key]; save(); }
export function saveProject(fullName, project) { data.projects[fullName] = { ...project, updatedAt: now() }; save(); }
export function getProject(fullName) { return data.projects[fullName] || null; }
export function listProjects() { return Object.values(data.projects).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))); }
export function addSecret(secret) { data.secrets.push({ ...secret, updatedAt: now() }); save(); }
export function listSecrets() { return [...data.secrets].sort((a,b) => (a.scope+a.name).localeCompare(b.scope+b.name)); }
export function deleteSecret(id) { data.secrets = data.secrets.filter(s => s.id !== id); save(); }
export function setRollback(repo, rollback) { data.rollbacks[repo] = { ...rollback, createdAt: now() }; save(); }
export function getRollback(repo) { return data.rollbacks[repo] || null; }
export function audit(action, details = {}) { data.audit.unshift({ action, details, createdAt: now() }); data.audit = data.audit.slice(0, 500); save(); }
export function exportData() { return { exportedAt: now(), ...data, settings: Object.fromEntries(Object.entries(data.settings).map(([k,v]) => [k, k.toLowerCase().includes('token') ? { savedAt: v.savedAt, source: v.source, updatedAt: v.updatedAt, encrypted: true } : v])) }; }
