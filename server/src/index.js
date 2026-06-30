import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import AdmZip from 'adm-zip';
import { encryptText, decryptText } from './crypto.js';
import { now, getSetting, setSetting, deleteSetting, saveProject, listProjects, getProject, addSecret, listSecrets, deleteSecret, setRollback, getRollback, audit, exportData } from './db.js';
import { listRepos, getTree, getFileContent, putFile, resetBranch } from './github.js';
import { analyzeRepository, limitReadable } from './analyze.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const app = express();
const PORT = Number(process.env.PORT || 8787);
const isProd = process.env.NODE_ENV === 'production';
const sessions = new Map();
const oauthStates = new Map();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '25mb' }));
app.use(express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '120mb' }));
app.use(cookieParser());
app.use(express.static(path.join(rootDir, 'public')));

function requireAuth(req, res, next) { const sid = req.cookies?.dh_session; if (!sid || !sessions.has(sid)) return res.status(401).json({ error: 'Nicht angemeldet.' }); next(); }
function setSession(res) { const sid = nanoid(48); sessions.set(sid, { createdAt: Date.now() }); res.cookie('dh_session', sid, { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 1000*60*60*24*30 }); }

app.post('/api/auth/login', (req, res) => {
  const password = req.body?.password || '';
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'bitte-aendern') return res.status(500).json({ error: 'ADMIN_PASSWORD ist in .env nicht gesetzt.' });
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Falsches Passwort.' });
  setSession(res); audit('login'); res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => { const sid = req.cookies?.dh_session; if (sid) sessions.delete(sid); res.clearCookie('dh_session'); res.json({ ok:true }); });
app.get('/api/me', requireAuth, (req,res) => res.json({ ok:true, hasGithubToken: Boolean(getSetting('githubToken')?.encrypted), oauthConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) }));

app.get('/api/auth/github/start', requireAuth, (req,res) => {
  if (!process.env.GITHUB_CLIENT_ID) return res.status(400).send('GitHub OAuth ist nicht konfiguriert. Nutze den Token-Speicher oder setze GITHUB_CLIENT_ID/SECRET.');
  const state = nanoid(32); oauthStates.set(state, Date.now());
  const callback = process.env.GITHUB_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/github/callback`;
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', callback);
  url.searchParams.set('scope', 'repo read:user');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});
app.get('/api/auth/github/callback', requireAuth, async (req,res) => {
  const { code, state } = req.query;
  if (!state || !oauthStates.has(state)) return res.status(400).send('OAuth-State ungültig.');
  oauthStates.delete(state);
  const callback = process.env.GITHUB_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/github/callback`;
  const r = await fetch('https://github.com/login/oauth/access_token', { method:'POST', headers:{ Accept:'application/json' }, body: new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: callback }) });
  const data = await r.json();
  if (!data.access_token) return res.status(400).send('Kein GitHub Access Token erhalten.');
  setSetting('githubToken', { encrypted: encryptText(data.access_token), savedAt: now(), source: 'oauth' }); audit('github_oauth_saved'); res.redirect('/');
});

app.post('/api/settings/github-token', requireAuth, (req,res) => { const token = req.body?.token || ''; if (token.length < 20) return res.status(400).json({ error:'Token fehlt oder ist zu kurz.' }); setSetting('githubToken', { encrypted: encryptText(token), savedAt: now(), source:'manual' }); audit('github_token_saved'); res.json({ ok:true }); });
app.delete('/api/settings/github-token', requireAuth, (req,res) => { deleteSetting('githubToken'); audit('github_token_deleted'); res.json({ ok:true }); });

app.get('/api/repos', requireAuth, async (req,res) => { try { res.json({ repos: await listRepos() }); } catch(e) { res.status(500).json({ error:e.message }); } });
app.post('/api/repos/scan', requireAuth, async (req,res) => {
  try {
    const repo = req.body?.repo; if (!repo?.fullName) return res.status(400).json({ error:'Repository fehlt.' });
    const branch = repo.defaultBranch || 'main';
    const { tree } = await getTree(repo.fullName, branch);
    const readable = limitReadable(tree);
    const files = [];
    for (const item of readable) { try { files.push({ path:item.path, size:item.size, content: await getFileContent(repo.fullName, item.path, branch) }); } catch {} }
    const analysis = analyzeRepository(repo, files, listProjects());
    const old = getProject(repo.fullName) || {};
    const project = { repo, analysis, notes: old.notes || '', manualContext: old.manualContext || '', updatedAt: now() };
    saveProject(repo.fullName, project); audit('repo_scanned', { repo: repo.fullName, files: files.length });
    res.json({ project, filesRead: files.map(f=>f.path) });
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.post('/api/repos/scan-all', requireAuth, async (req,res) => {
  try {
    const repos = await listRepos(); const results = [];
    for (const repo of repos) {
      try {
        const { tree } = await getTree(repo.fullName, repo.defaultBranch || 'main');
        const files = [];
        for (const item of limitReadable(tree)) { try { files.push({ path:item.path, size:item.size, content: await getFileContent(repo.fullName, item.path, repo.defaultBranch || 'main') }); } catch {} }
        const analysis = analyzeRepository(repo, files, listProjects());
        const old = getProject(repo.fullName) || {};
        const project = { repo, analysis, notes: old.notes || '', manualContext: old.manualContext || '', updatedAt: now() };
        saveProject(repo.fullName, project); results.push({ fullName: repo.fullName, ok:true });
      } catch(e) { results.push({ fullName: repo.fullName, ok:false, error:e.message }); }
    }
    audit('scan_all', { count: results.length }); res.json({ results });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/projects', requireAuth, (req,res) => res.json({ projects: listProjects() }));
app.get('/api/projects/:owner/:repo', requireAuth, (req,res) => { const p = getProject(`${req.params.owner}/${req.params.repo}`); if (!p) return res.status(404).json({ error:'Projekt nicht gefunden.' }); res.json({ project:p }); });
app.post('/api/projects/:owner/:repo/notes', requireAuth, (req,res) => { const fullName = `${req.params.owner}/${req.params.repo}`; const p = getProject(fullName); if (!p) return res.status(404).json({ error:'Projekt nicht gefunden.' }); p.notes = req.body?.notes || ''; p.manualContext = req.body?.manualContext || p.manualContext || ''; p.updatedAt = now(); saveProject(fullName, p); audit('project_notes_saved', { fullName }); res.json({ ok:true, project:p }); });

app.post('/api/secrets', requireAuth, (req,res) => { const { scope='global', name, value, note='' } = req.body || {}; if (!name || !value) return res.status(400).json({ error:'Name und Wert sind Pflicht.' }); const id = nanoid(); addSecret({ id, scope, name, encrypted_value: encryptText(value), note }); audit('secret_saved', { scope, name }); res.json({ ok:true, id }); });
app.get('/api/secrets', requireAuth, (req,res) => res.json({ secrets: listSecrets().map(({ encrypted_value, ...s }) => s) }));
app.delete('/api/secrets/:id', requireAuth, (req,res) => { deleteSecret(req.params.id); audit('secret_deleted'); res.json({ ok:true }); });

app.get('/api/context/:owner/:repo', requireAuth, (req,res) => {
  const fullName = `${req.params.owner}/${req.params.repo}`; const project = getProject(fullName); if (!project) return res.status(404).json({ error:'Projekt nicht gefunden.' });
  const all = listProjects(); const ids = project.analysis?.firebase?.projectIds || [];
  const related = all.filter(p => p.fullName !== fullName && (p.analysis?.firebase?.projectIds || []).some(id => ids.includes(id)));
  const secrets = listSecrets().filter(s => s.scope === fullName || s.scope === 'global').map(({ scope, name, note }) => ({ scope, name, note }));
  res.json({ prompt: buildPrompt(project, related, secrets), related });
});
function buildPrompt(project, related, secrets) {
  const a = project.analysis || {}; const f = a.firebase || {};
  return `Ich möchte dieses Projekt weiterentwickeln. Bitte berücksichtige diesen aktuellen Stand.\n\n# Projekt\n${a.fullName}\n\n# Zweck\n${a.purpose}\n\n# Repository\n${a.htmlUrl}\nDefault Branch: ${a.defaultBranch}\nGitHub Pages: ${a.pagesUrl || 'nicht erkannt'}\n\n# Technik\n${(a.tech || []).map(x => '- ' + x).join('\n') || '- nicht erkannt'}\n\n# Firebase\nProjekt-IDs: ${(f.projectIds || []).join(', ') || 'keine erkannt'}\nDatenbank-URLs: ${(f.dbUrls || []).join(', ') || 'keine erkannt'}\nDatenpfade: ${(f.paths || []).join(', ') || 'keine erkannt'}\n\n# Architektur\n${(a.architecture || []).map(x => '- ' + x).join('\n') || '- keine Details'}\n\n# Wichtige Dateien\n${(a.importantFiles || []).map(x => '- ' + x).join('\n') || '- keine erkannt'}\n\n# Projekt-Wiki\n${a.wiki || ''}\n\n# Manuelle Notizen\n${project.notes || 'Keine'}\n\n# Zusätzlicher Projektkontext\n${project.manualContext || 'Keine'}\n\n# Gemeinsame Ressourcen / Abhängigkeiten\n${related.length ? related.map(p => `- ${p.fullName}: teilt vermutlich Firebase-Projekt ${(p.analysis?.firebase?.projectIds || []).join(', ')}`).join('\n') : '- Keine gemeinsamen Ressourcen erkannt'}\n\n# Hinterlegte Secrets\n${secrets.length ? secrets.map(s => `- ${s.scope}: ${s.name}${s.note ? ' (' + s.note + ')' : ''}`).join('\n') : '- Keine Secrets hinterlegt'}\nWichtig: Secrets sind nur im Developer Hub gespeichert und dürfen nicht ausgeschrieben werden. Wenn sie für Deployment nötig sind, benenne nur den Secret-Namen.\n\n# Regeln für Änderungen\n${(a.guardrails || []).map(x => '- ' + x).join('\n')}\n\nWenn du Code änderst, liefere am Ende eine vollständige ZIP für das Repository. Nicht enthaltene Dateien sollen nicht gelöscht werden, außer ich verlange es ausdrücklich.\n`;
}

app.post('/api/deploy/:owner/:repo/zip', requireAuth, async (req,res) => {
  try {
    const fullName = `${req.params.owner}/${req.params.repo}`; const project = getProject(fullName); if (!project) return res.status(404).json({ error:'Projekt erst scannen.' });
    const branch = project.repo.defaultBranch || 'main'; const { headSha } = await getTree(fullName, branch);
    setRollback(fullName, { branch, sha: headSha });
    const zip = new AdmZip(req.body); const entries = zip.getEntries().filter(e => !e.isDirectory);
    const commitMessage = `Upload via Developer Hub ${new Date().toLocaleString('de-DE')}`; const changed = []; const skipped = [];
    for (const entry of entries) {
      let p = entry.entryName.replace(/^\/+/, '');
      if (!p || p.includes('..') || p.includes('__MACOSX') || path.basename(p).startsWith('.DS_Store')) { skipped.push(p); continue; }
      if (/node_modules\//.test(p)) { skipped.push(p); continue; }
      await putFile(fullName, branch, p, entry.getData(), commitMessage); changed.push(p);
    }
    audit('zip_deployed', { repo:fullName, changed:changed.length, rollbackSha:headSha }); res.json({ ok:true, changed, skipped, rollbackSha:headSha });
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.post('/api/deploy/:owner/:repo/rollback', requireAuth, async (req,res) => { try { const fullName = `${req.params.owner}/${req.params.repo}`; const row = getRollback(fullName); if (!row) return res.status(404).json({ error:'Kein Rollback-Punkt vorhanden.' }); await resetBranch(fullName, row.branch, row.sha); audit('rollback', { repo:fullName, sha:row.sha }); res.json({ ok:true, ...row }); } catch(e) { res.status(500).json({ error:e.message }); } });

app.get('/api/export', requireAuth, (req,res) => { const payload = exportData(); res.setHeader('Content-Type', 'application/json'); res.send(JSON.stringify(payload, null, 2)); });
app.get('*', (req,res) => res.sendFile(path.join(rootDir, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Developer Hub läuft auf Port ${PORT}`));
