import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { nanoid } from 'nanoid';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'url';
import { encryptText, decryptText } from './crypto.js';
import { db, getSetting, setSetting, saveProject, listProjects, getProject } from './db.js';
import { listRepos, getTree, getFileContent, putFile, resetBranch, gh } from './github.js';
import { analyzeRepository, limitReadable } from './analyze.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 8787);
const isProd = process.env.NODE_ENV === 'production';
const sessions = new Map();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.raw({ type: 'application/zip', limit: '80mb' }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 60 * 1000, limit: 240 }));

function now() { return new Date().toISOString(); }
function audit(action, details = {}) {
  db.prepare('INSERT INTO audit_log (id, action, details, created_at) VALUES (?, ?, ?, ?)').run(nanoid(), action, JSON.stringify(details), now());
}
function requireAuth(req, res, next) {
  const sid = req.cookies?.dh_session;
  if (!sid || !sessions.has(sid)) return res.status(401).json({ error: 'Nicht angemeldet.' });
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'bitte-aendern') return res.status(500).json({ error: 'ADMIN_PASSWORD ist nicht gesetzt.' });
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Falsches Passwort.' });
  const sid = nanoid(48);
  sessions.set(sid, { createdAt: Date.now() });
  res.cookie('dh_session', sid, { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const sid = req.cookies?.dh_session;
  if (sid) sessions.delete(sid);
  res.clearCookie('dh_session');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const hasGithubToken = Boolean(getSetting('githubToken')?.encrypted);
  res.json({ ok: true, hasGithubToken });
});

app.post('/api/settings/github-token', requireAuth, (req, res) => {
  const { token } = req.body || {};
  if (!token || token.length < 20) return res.status(400).json({ error: 'Token fehlt oder ist zu kurz.' });
  setSetting('githubToken', { encrypted: encryptText(token), savedAt: now() });
  audit('github_token_saved');
  res.json({ ok: true });
});

app.get('/api/repos', requireAuth, async (req, res) => {
  try { res.json({ repos: await listRepos() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/repos/scan', requireAuth, async (req, res) => {
  try {
    const { repo } = req.body || {};
    if (!repo?.fullName) return res.status(400).json({ error: 'Repository fehlt.' });
    const branch = repo.defaultBranch || 'main';
    const { tree } = await getTree(repo.fullName, branch);
    const readable = limitReadable(tree);
    const files = [];
    for (const item of readable) {
      try {
        const content = await getFileContent(repo.fullName, item.path, branch);
        files.push({ path: item.path, size: item.size, content });
      } catch {}
    }
    const analysis = analyzeRepository(repo, files);
    const project = { repo, analysis, notes: getProject(repo.fullName)?.notes || '', secrets: [], updatedAt: now() };
    saveProject(repo.fullName, project);
    audit('repo_scanned', { repo: repo.fullName });
    res.json({ project, filesRead: files.map(f => f.path) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/projects', requireAuth, (req, res) => {
  res.json({ projects: listProjects() });
});

app.get('/api/projects/:owner/:repo', requireAuth, (req, res) => {
  const fullName = `${req.params.owner}/${req.params.repo}`;
  const project = getProject(fullName);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
  res.json({ project });
});

app.post('/api/projects/:owner/:repo/notes', requireAuth, (req, res) => {
  const fullName = `${req.params.owner}/${req.params.repo}`;
  const project = getProject(fullName);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
  project.notes = req.body?.notes || '';
  project.updatedAt = now();
  saveProject(fullName, project);
  res.json({ ok: true, project });
});

app.post('/api/secrets', requireAuth, (req, res) => {
  const { scope, name, value, note } = req.body || {};
  if (!scope || !name || !value) return res.status(400).json({ error: 'scope, name und value sind Pflicht.' });
  const id = nanoid();
  db.prepare('INSERT INTO secrets (id, scope, name, encrypted_value, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, scope, name, encryptText(value), note || '', now());
  audit('secret_saved', { scope, name });
  res.json({ ok: true, id });
});

app.get('/api/secrets', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, scope, name, note, updated_at FROM secrets ORDER BY scope, name').all();
  res.json({ secrets: rows });
});

app.get('/api/context/:owner/:repo', requireAuth, (req, res) => {
  const fullName = `${req.params.owner}/${req.params.repo}`;
  const project = getProject(fullName);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
  const all = listProjects();
  const pid = project.analysis?.firebase?.projectIds || [];
  const related = all.filter(p => p.fullName !== fullName && (p.analysis?.firebase?.projectIds || []).some(x => pid.includes(x)));
  const secretRows = db.prepare('SELECT scope, name, note FROM secrets WHERE scope = ? OR scope = ? ORDER BY name').all(fullName, 'global');
  const prompt = buildPrompt(project, related, secretRows);
  res.json({ prompt, related });
});

function buildPrompt(project, related, secrets) {
  const a = project.analysis;
  return `Ich möchte dieses Projekt weiterentwickeln. Bitte berücksichtige den folgenden aktuellen Stand.\n\n# Projekt\n${a.fullName}\n\n# Zweck\n${a.purpose}\n\n# Repository\n${a.htmlUrl}\nDefault Branch: ${a.defaultBranch}\nGitHub Pages: ${a.pagesUrl || 'nicht erkannt'}\n\n# Technik\n${(a.tech || []).map(x => '- ' + x).join('\n') || '- nicht erkannt'}\n\n# Firebase\nProjekt-IDs: ${(a.firebase?.projectIds || []).join(', ') || 'keine erkannt'}\nDatenbank-URLs: ${(a.firebase?.dbUrls || []).join(', ') || 'keine erkannt'}\nDatenpfade: ${(a.firebase?.paths || []).join(', ') || 'keine erkannt'}\n\n# Architektur\n${(a.architecture || []).map(x => '- ' + x).join('\n') || '- keine Details'}\n\n# Wichtige Dateien\n${(a.importantFiles || []).map(x => '- ' + x).join('\n') || '- keine erkannt'}\n\n# Projekt-Wiki\n${a.wiki || ''}\n\n# Manuelle Notizen\n${project.notes || 'Keine'}\n\n# Gemeinsame Ressourcen / Abhängigkeiten\n${related.length ? related.map(p => `- ${p.fullName}: teilt vermutlich Firebase-Projekt ${(p.analysis?.firebase?.projectIds || []).join(', ')}`).join('\n') : '- Keine gemeinsamen Ressourcen erkannt'}\n\n# Hinterlegte Secrets\n${secrets.length ? secrets.map(s => `- ${s.scope}: ${s.name}${s.note ? ' (' + s.note + ')' : ''}`).join('\n') : '- Keine Secrets hinterlegt'}\nWichtig: Secrets sind nur im Developer Hub gespeichert und dürfen nicht ausgeschrieben werden.\n\n# Regeln für Änderungen\n${(a.guardrails || []).map(x => '- ' + x).join('\n')}\n\nWenn du Code änderst, liefere am Ende eine vollständige ZIP für das Repository. Nicht enthaltene Dateien sollen nicht gelöscht werden, außer ich verlange es ausdrücklich.\n`;
}

app.post('/api/deploy/:owner/:repo/zip', requireAuth, async (req, res) => {
  try {
    const fullName = `${req.params.owner}/${req.params.repo}`;
    const project = getProject(fullName);
    if (!project) return res.status(404).json({ error: 'Projekt erst scannen.' });
    const branch = project.repo.defaultBranch || 'main';
    const { headSha } = await getTree(fullName, branch);
    db.prepare('INSERT INTO rollbacks (repo_full_name, branch, sha, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(repo_full_name) DO UPDATE SET branch=excluded.branch, sha=excluded.sha, created_at=excluded.created_at')
      .run(fullName, branch, headSha, now());

    const zip = new AdmZip(req.body);
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    const safeEntries = entries.filter(e => !e.entryName.includes('__MACOSX') && !path.basename(e.entryName).startsWith('.'));
    const commitMessage = `Upload via Developer Hub ${new Date().toLocaleString('de-DE')}`;
    const changed = [];
    for (const entry of safeEntries) {
      const p = entry.entryName.replace(/^\/+/, '');
      if (!p || p.includes('..') || p.endsWith('/')) continue;
      const content = entry.getData();
      await putFile(fullName, branch, p, content, commitMessage);
      changed.push(p);
    }
    audit('zip_deployed', { repo: fullName, files: changed.length });
    res.json({ ok: true, changed, rollbackSha: headSha });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deploy/:owner/:repo/rollback', requireAuth, async (req, res) => {
  try {
    const fullName = `${req.params.owner}/${req.params.repo}`;
    const row = db.prepare('SELECT branch, sha FROM rollbacks WHERE repo_full_name = ?').get(fullName);
    if (!row) return res.status(404).json({ error: 'Kein Rollback-Punkt vorhanden.' });
    await resetBranch(fullName, row.branch, row.sha);
    audit('rollback', { repo: fullName, sha: row.sha });
    res.json({ ok: true, branch: row.branch, sha: row.sha });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export', requireAuth, (req, res) => {
  const settings = { hasGithubToken: Boolean(getSetting('githubToken')?.encrypted) };
  const secrets = db.prepare('SELECT id, scope, name, note, updated_at FROM secrets ORDER BY scope, name').all();
  res.json({ exportedAt: now(), settings, projects: listProjects(), secrets });
});

app.post('/api/import', requireAuth, (req, res) => {
  const { projects = [] } = req.body || {};
  for (const p of projects) if (p.fullName) saveProject(p.fullName, p);
  res.json({ ok: true, count: projects.length });
});

const dist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`Developer Hub läuft auf Port ${PORT}`));
