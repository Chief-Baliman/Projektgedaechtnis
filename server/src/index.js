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
app.post('/api/projects/:owner/:repo/notes', requireAuth, (req,res) => { const fullName = `${req.params.owner}/${req.params.repo}`; const p = getProject(fullName); if (!p) return res.status(404).json({ error:'Projekt nicht gefunden.' }); p.notes = req.body?.notes || ''; p.manualContext = req.body?.manualContext || p.manualContext || ''; if (req.body?.projectSpaceKey && p.analysis) { const map = { quizt:{ key:'quizt', name:'Quizt / Laura', type:'externes Projekt', owner:'Laura / Quizt', separation:'Nicht mit ChiefCards vermischen. Fabian entwickelt Technik, aber Quizt ist inhaltlich und organisatorisch ein eigenes Projekt.' }, chiefcards:{ key:'chiefcards', name:'ChiefCards / Fabian', type:'eigenes Business', owner:'Fabian / ChiefCards', separation:'Gehört zu ChiefCards, Stream, Shop, Kartenhandel oder internen Tools.' }, server:{ key:'server', name:'Server / Bots', type:'Infrastruktur', owner:'Fabian', separation:'Servernahe Dienste getrennt von einzelnen Markenprojekten dokumentieren.' }, unknown:{ key:'unknown', name:'Unsortiert', type:'noch einordnen', owner:'unbekannt', separation:'Projektgruppe manuell prüfen.' } }; p.analysis.projectSpace = map[req.body.projectSpaceKey] || p.analysis.projectSpace; } p.updatedAt = now(); saveProject(fullName, p); audit('project_notes_saved', { fullName }); res.json({ ok:true, project:p }); });

app.post('/api/secrets', requireAuth, (req,res) => { const { scope='global', name, value, note='' } = req.body || {}; if (!name || !value) return res.status(400).json({ error:'Name und Wert sind Pflicht.' }); const id = nanoid(); addSecret({ id, scope, name, encrypted_value: encryptText(value), note }); audit('secret_saved', { scope, name }); res.json({ ok:true, id }); });
app.get('/api/secrets', requireAuth, (req,res) => res.json({ secrets: listSecrets().map(({ encrypted_value, ...s }) => s) }));
app.delete('/api/secrets/:id', requireAuth, (req,res) => { deleteSecret(req.params.id); audit('secret_deleted'); res.json({ ok:true }); });

app.get('/api/context/:owner/:repo', requireAuth, (req,res) => {
  const fullName = `${req.params.owner}/${req.params.repo}`; const project = getProject(fullName); if (!project) return res.status(404).json({ error:'Projekt nicht gefunden.' });
  const all = listProjects(); const ids = project.analysis?.firebase?.projectIds || []; const spaceKey = project.analysis?.projectSpace?.key;
  const related = all.filter(p => p.fullName !== fullName && (
    (p.analysis?.firebase?.projectIds || []).some(id => ids.includes(id)) ||
    (spaceKey && p.analysis?.projectSpace?.key === spaceKey)
  ));
  const secrets = listSecrets().filter(s => s.scope === fullName || s.scope === 'global').map(({ scope, name, note }) => ({ scope, name, note }));
  res.json({ prompt: buildPrompt(project, related, secrets), related });
});
function buildPrompt(project, related, secrets) {
  const a = project.analysis || {}; const f = a.firebase || {}; const space = a.projectSpace || {};
  const hardDeps = related.filter(p => (p.analysis?.firebase?.projectIds || []).some(id => (f.projectIds || []).includes(id)));
  const sameSpace = related.filter(p => p.analysis?.projectSpace?.key === space.key && !hardDeps.includes(p));
  return `Ich möchte dieses Projekt weiterentwickeln. Bitte berücksichtige diesen aktuellen Stand.

# Projekt
${a.fullName}

# Projektgruppe / Besitz
Bereich: ${space.name || 'nicht erkannt'}
Typ: ${space.type || 'nicht erkannt'}
Verantwortlich: ${space.owner || 'nicht erkannt'}
Trennung: ${space.separation || 'Keine Angabe'}
${(a.ownershipNotes || []).map(x => '- ' + x).join('\n')}

# Zweck
${a.purpose || 'nicht erkannt'}

# Repository
${a.htmlUrl}
Default Branch: ${a.defaultBranch}
GitHub Pages: ${a.pagesUrl || 'nicht erkannt'}

# Technik
${(a.tech || []).map(x => '- ' + x).join('\n') || '- nicht erkannt'}

# Firebase
Projekt-IDs: ${(f.projectIds || []).join(', ') || 'keine erkannt'}
Datenbank-URLs: ${(f.dbUrls || []).join(', ') || 'keine erkannt'}
Datenpfade: ${(f.paths || []).join(', ') || 'keine erkannt'}
Rules erwähnt: ${f.rulesMentioned ? 'ja' : 'nein'}

# Architektur
${(a.architecture || []).map(x => '- ' + x).join('\n') || '- keine Details'}

# Code-Signatur und echte Scanner-Funde
App-Domänen: ${(a.codeInsights?.domains || []).join(', ') || 'keine erkannt'}
Code-Signatur: ${(a.codeInsights?.signature || []).join(', ') || 'keine erkannt'}
Wichtige Funktionen: ${(a.codeInsights?.functions || []).slice(0, 40).join(', ') || 'keine erkannt'}
UI-Texte/Buttons: ${(a.codeInsights?.uiLabels || []).slice(0, 40).join(', ') || 'keine erkannt'}
Datei-Zusammenfassung:
${(a.codeInsights?.fileSummaries || []).map(x => '- ' + x).join('\n') || '- keine erkannt'}
Scan-Qualität: ${a.scanQuality?.quality || 'unbekannt'} mit ${a.scanQuality?.extractedSignals || 0} extrahierten Signalen aus ${a.scanQuality?.filesRead || 0} Dateien.

# Erkannte Datenmodelle / Routen
Datenmodelle: ${(a.dataModel || []).join(', ') || 'keine erkannt'}
Routen/API-Pfade: ${(a.routes || []).join(', ') || 'keine erkannt'}

# Wichtige Dateien
${(a.importantFiles || []).map(x => '- ' + x).join('\n') || '- keine erkannt'}

# Projekt-Wiki
${a.wiki || ''}

# Manuelle Notizen
${project.notes || 'Keine'}

# Zusätzlicher Projektkontext
${project.manualContext || 'Keine'}

# Harte Abhängigkeiten / geteilte Ressourcen
${hardDeps.length ? hardDeps.map(p => `- ${p.fullName}: teilt Firebase-Projekt ${(p.analysis?.firebase?.projectIds || []).filter(id => (f.projectIds || []).includes(id)).join(', ')}; Bereich: ${p.analysis?.projectSpace?.name || 'unbekannt'}`).join('\n') : '- Keine harten geteilten Ressourcen erkannt'}

# Verwandte Projekte gleicher Projektgruppe
${sameSpace.length ? sameSpace.map(p => `- ${p.fullName}: ${p.analysis?.purpose || ''}`).join('\n') : '- Keine weiteren Projekte gleicher Gruppe erkannt'}

# Hinterlegte Secrets
${secrets.length ? secrets.map(s => `- ${s.scope}: ${s.name}${s.note ? ' (' + s.note + ')' : ''}`).join('\n') : '- Keine Secrets hinterlegt'}
Wichtig: Secrets sind nur im Developer Hub gespeichert und dürfen nicht ausgeschrieben werden. Wenn sie für Deployment nötig sind, benenne nur den Secret-Namen.

# Regeln für Änderungen
${(a.guardrails || []).map(x => '- ' + x).join('\n')}

Wenn du Code änderst, liefere am Ende eine vollständige ZIP für das Repository. Nicht enthaltene Dateien sollen nicht gelöscht werden, außer ich verlange es ausdrücklich.
`;
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
app.use((req,res) => res.sendFile(path.join(rootDir, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Developer Hub läuft auf Port ${PORT}`));
