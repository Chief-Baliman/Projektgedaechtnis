import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { PORT, APP_ORIGIN, ADMIN_PASSWORD } from './config.js';
import { audit, exportData, getAllProjects, buildFirebaseContext, buildServerContext, getFirebaseAggregate, getFirebaseDocs, getFirebaseRulesLibrary, getGithubToken, getNote, getResourceGraph, getRollback, getScan, getSettingsSafe, getServerAiAnalyses, getServerDocs, listSecrets, revealSecret, saveAiSettings, saveFirebaseDoc, saveGithubToken, saveServerDoc, saveNote, saveRollback, saveScan, saveSecret, setProjectGroup } from './store.js';
import { estimateAiAnalysis, estimateServerAiAnalysis, getAiProviders, runAiAnalysis, runServerAiAnalysis } from './aiAnalyzer.js';
import { listRepos, getBranchHead, putFile, resetBranch } from './github.js';
import { scanRepository, SCANNER_VERSION } from './scanner/index.js';
import { getServerInventory, getServerProjectDetails } from './serverInventory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const publicDir = path.join(rootDir, 'public');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: APP_ORIGIN === '*' ? true : APP_ORIGIN, credentials: true }));
app.use(express.json({ limit: '8mb' }));
app.use(express.static(publicDir));

const sessions = new Set();

function makeSession() {
  return Buffer.from(`${Date.now()}:${Math.random()}:${Math.random()}`).toString('base64url');
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.session;
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  next();
}

app.get('/api/health', (req,res) => res.json({ ok:true, app:'Chief Developer Hub', scannerVersion: SCANNER_VERSION, at:new Date().toISOString() }));

app.post('/api/login', (req,res) => {
  const { password } = req.body || {};
  if (String(password || '') !== String(ADMIN_PASSWORD || '')) return res.status(401).json({ error:'Falsches Passwort.' });
  const session = makeSession();
  sessions.add(session);
  audit('login', {});
  res.json({ ok:true, session, settings:{ ...getSettingsSafe(), aiProviders:getAiProviders() }, scannerVersion: SCANNER_VERSION });
});

app.post('/api/logout', requireAuth, (req,res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) sessions.delete(token);
  res.json({ ok:true });
});

app.get('/api/settings', requireAuth, (req,res) => res.json({ ...getSettingsSafe(), aiProviders:getAiProviders() }));
app.post('/api/github/token', requireAuth, (req,res) => { saveGithubToken(req.body?.token || ''); res.json({ ok:true, settings:{ ...getSettingsSafe(), aiProviders:getAiProviders() } }); });
app.post('/api/ai/settings', requireAuth, (req,res) => { saveAiSettings(req.body?.provider || 'gemini', req.body?.model || ''); res.json({ ok:true, settings:{ ...getSettingsSafe(), aiProviders:getAiProviders() } }); });
app.post('/api/ai/key', requireAuth, (req,res) => { const provider = String(req.body?.provider || 'gemini').toLowerCase(); const keyName = `AI_KEY_${provider.toUpperCase()}`; saveSecret(keyName, req.body?.key || '', { type:provider, purpose:'KI-Codeanalyse' }); res.json({ ok:true, settings:{ ...getSettingsSafe(), aiProviders:getAiProviders() } }); });
app.post('/api/openai/key', requireAuth, (req,res) => { saveSecret('AI_KEY_OPENAI', req.body?.key || '', { type:'openai', purpose:'KI-Codeanalyse' }); res.json({ ok:true, settings:{ ...getSettingsSafe(), aiProviders:getAiProviders() } }); });
app.get('/api/github/repos', requireAuth, async (req,res) => { try { res.json(await listRepos()); } catch(e) { res.status(500).json({ error:e.message }); } });

app.get('/api/projects', requireAuth, (req,res) => res.json({ projects:getAllProjects(), resources:getResourceGraph() }));

app.get('/api/server/inventory', requireAuth, async (req,res) => {
  try { res.json(await getServerInventory()); }
  catch(e) { console.error(e); res.status(500).json({ error:e.message }); }
});

app.get('/api/server/docs', requireAuth, (req,res) => res.json({ docs:getServerDocs() }));
app.post('/api/server/docs', requireAuth, (req,res) => { saveServerDoc(req.body?.key, req.body || {}); res.json({ ok:true, docs:getServerDocs() }); });
app.get('/api/server/context', requireAuth, async (req,res) => {
  try { res.json({ context: buildServerContext(await getServerInventory()), docs:getServerDocs() }); }
  catch(e) { res.status(500).json({ error:e.message }); }
});


app.get('/api/server/ai', requireAuth, (req,res) => res.json({ analyses:getServerAiAnalyses() }));

app.get('/api/server/project/details', requireAuth, async (req,res) => {
  try { res.json(await getServerProjectDetails({ path:req.query.path, unit:req.query.unit })); }
  catch(e) { console.error(e); res.status(500).json({ error:e.message }); }
});

app.get('/api/server/project/ai/estimate', requireAuth, async (req,res) => {
  try {
    const details = await getServerProjectDetails({ path:req.query.path, unit:req.query.unit });
    const estimate = await estimateServerAiAnalysis(details, { provider:req.query.provider, model:req.query.model });
    res.json(estimate);
  } catch(e) { console.error(e); res.status(500).json({ error:e.message }); }
});

app.post('/api/server/project/ai/analyze', requireAuth, async (req,res) => {
  try {
    const details = await getServerProjectDetails({ path:req.body?.path, unit:req.body?.unit });
    const ai = await runServerAiAnalysis(details, { provider:req.body?.provider, model:req.body?.model });
    res.json({ ok:true, ai, analyses:getServerAiAnalyses() });
  } catch(e) { console.error(e); res.status(500).json({ error:e.message }); }
});

app.get('/api/firebase/aggregate', requireAuth, (req,res) => res.json(getFirebaseAggregate()));
app.get('/api/firebase/docs', requireAuth, (req,res) => res.json(getFirebaseDocs()));
app.get('/api/firebase/rules', requireAuth, (req,res) => res.json({ rules:getFirebaseRulesLibrary() }));
app.get('/api/firebase/context', requireAuth, (req,res) => res.json({ context:buildFirebaseContext(), docs:getFirebaseDocs(), aggregate:getFirebaseAggregate() }));
app.post('/api/firebase/docs', requireAuth, (req,res) => { saveFirebaseDoc(req.body?.key, req.body || {}); res.json({ ok:true, docs:getFirebaseDocs(), aggregate:getFirebaseAggregate(), rules:getFirebaseRulesLibrary() }); });

app.post('/api/projects/group', requireAuth, (req,res) => { setProjectGroup(req.body.fullName, req.body.group); res.json({ ok:true }); });
app.get('/api/projects/:owner/:repo/scan', requireAuth, (req,res) => { const fullName = `${req.params.owner}/${req.params.repo}`; const scan = getScan(fullName); if (!scan) return res.status(404).json({ error:'Noch kein Scan vorhanden.' }); res.json(scan); });

app.post('/api/projects/:owner/:repo/scan', requireAuth, async (req,res) => {
  try {
    const fullName = `${req.params.owner}/${req.params.repo}`;
    const analysis = await scanRepository(fullName);
    saveScan(fullName, analysis);
    res.json(analysis);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error:e.message });
  }
});



app.get('/api/projects/:owner/:repo/ai/estimate', requireAuth, async (req,res) => {
  try {
    const fullName = `${req.params.owner}/${req.params.repo}`;
    const scan = getScan(fullName);
    if (!scan) return res.status(400).json({ error:'Bitte zuerst einen normalen Repository-Scan ausführen.' });
    const estimate = await estimateAiAnalysis(fullName, scan, { provider:req.query?.provider, model:req.query?.model, mode:req.query?.mode });
    res.json(estimate);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error:e.message });
  }
});

app.post('/api/projects/:owner/:repo/ai/analyze', requireAuth, async (req,res) => {
  try {
    const fullName = `${req.params.owner}/${req.params.repo}`;
    const scan = getScan(fullName);
    if (!scan) return res.status(400).json({ error:'Bitte zuerst einen normalen Repository-Scan ausführen.' });
    const ai = await runAiAnalysis(fullName, scan, { provider:req.body?.provider, model:req.body?.model, mode:req.body?.mode });
    res.json({ ok:true, ai, scan:getScan(fullName) });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error:e.message });
  }
});

app.get('/api/projects/:owner/:repo/note', requireAuth, (req,res) => res.json(getNote(`${req.params.owner}/${req.params.repo}`)));
app.post('/api/projects/:owner/:repo/note', requireAuth, (req,res) => { saveNote(`${req.params.owner}/${req.params.repo}`, req.body?.text || ''); res.json({ ok:true }); });

app.get('/api/secrets', requireAuth, (req,res) => res.json(listSecrets()));
app.post('/api/secrets', requireAuth, (req,res) => { saveSecret(req.body?.name, req.body?.value, req.body?.meta || {}); res.json({ ok:true }); });
app.post('/api/secrets/reveal', requireAuth, (req,res) => { const secret = revealSecret(req.body?.name); if (!secret) return res.status(404).json({ error:'Secret nicht gefunden.' }); res.json(secret); });

app.post('/api/deploy/:owner/:repo/zip', requireAuth, upload.single('zip'), async (req,res) => {
  try {
    if (!req.file) return res.status(400).json({ error:'Keine ZIP hochgeladen.' });
    const fullName = `${req.params.owner}/${req.params.repo}`;
    const scan = getScan(fullName);
    const branch = req.body.branch || scan?.repo?.defaultBranch || 'main';
    const headSha = await getBranchHead(fullName, branch);
    saveRollback(fullName, { branch, sha: headSha, source:'before_zip_deploy' });
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    const changed = [];
    const skipped = [];
    const commitMessage = `Upload via Developer Hub ${new Date().toLocaleString('de-DE')}`;
    for (const entry of entries) {
      let p = entry.entryName.replace(/^\/+/, '');
      if (!p || p.includes('..') || p.includes('__MACOSX') || path.basename(p).startsWith('.DS_Store')) { skipped.push(p); continue; }
      if (/node_modules\//.test(p) || /^data\//.test(p) || p === '.env') { skipped.push(p); continue; }
      await putFile(fullName, branch, p, entry.getData(), commitMessage);
      changed.push(p);
    }
    audit('zip_deployed', { repo:fullName, changed:changed.length, skipped:skipped.length, rollbackSha:headSha });
    res.json({ ok:true, changed, skipped, rollbackSha:headSha });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error:e.message });
  }
});

app.post('/api/deploy/:owner/:repo/rollback', requireAuth, async (req,res) => {
  try {
    const fullName = `${req.params.owner}/${req.params.repo}`;
    const row = getRollback(fullName);
    if (!row) return res.status(404).json({ error:'Kein Rollback-Punkt vorhanden.' });
    await resetBranch(fullName, row.branch, row.sha);
    audit('rollback', { repo:fullName, sha:row.sha });
    res.json({ ok:true, ...row });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error:e.message });
  }
});

app.get('/api/export', requireAuth, (req,res) => { res.setHeader('Content-Type', 'application/json'); res.send(JSON.stringify(exportData(), null, 2)); });

app.use((req,res) => res.sendFile(path.join(publicDir, 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Developer Hub läuft auf Port ${PORT}`));
