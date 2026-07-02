const state = {
  session: localStorage.getItem('dh_session') || '',
  repos: [],
  selectedRepo: '',
  scan: null,
  tab: 'overview',
  message: '',
  error: '',
  settings: null,
  projects: [],
  resources: [],
  aiEstimate: null,
  globalView: 'dashboard',
  serverInventory: null,
  serverDocs: [],
  serverAiAnalyses: [],
  serverAiEstimate: null,
  firebaseAggregate: null
};

const GROUPS = {
  'chiefcards': 'ChiefCards',
  'chiefbaliman': 'ChiefBaliman',
  'quizt-laura': 'Quizt / Laura',
  'infrastruktur': 'Infrastruktur',
  'privat': 'Privat',
  'unsortiert': 'Unsortiert'
};

const app = document.getElementById('app');

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(state.session ? { Authorization: `Bearer ${state.session}` } : {}),
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(data?.error || text || `Fehler ${res.status}`);
  return data;
}

function render() {
  if (!state.session) return renderLogin();
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">Developer Hub</div>
        <div class="sub">Projektgedächtnis, Code-Scanner, Kontextgenerator und Deployment.</div>
        <div style="height:14px"></div>
        <div class="card">
          <div class="stack">
            <button onclick="loadRepos()">Repositories laden</button>
            <button class="secondary" onclick="loadProjects()">Projektgraph laden</button>
            <button class="secondary" onclick="showServerInventory()">Server & Bots</button>
            <button class="secondary" onclick="showFirebaseInventory()">Firebase</button>
          </div>
        </div>
        <div class="card">
          <div class="meta">GitHub Token</div>
          <div class="row">
            <input id="tokenInput" type="password" placeholder="Token einfügen">
            <button onclick="saveToken()">Speichern</button>
          </div>
          <div class="meta" style="margin-top:8px">${state.settings?.hasGithubToken ? `Gespeichert: ${escapeHtml(state.settings.githubTokenHint || 'ja')}` : 'Noch kein Token gespeichert'}</div>
        </div>
        <div class="card">
          <div class="meta">KI-Anbieter</div>
          <select id="aiProvider" onchange="fillAiModelDefault()">${renderAiProviderOptions()}</select>
          <div style="height:8px"></div>
          <input id="aiModel" placeholder="Modell" value="${escapeAttr(getCurrentAiModel())}">
          <div style="height:8px"></div>
          <div class="row">
            <input id="aiKeyInput" type="password" placeholder="API Key einfügen">
            <button onclick="saveAiProviderAndKey()">Speichern</button>
          </div>
          <div class="meta" style="margin-top:8px">${renderAiKeyStatus()}</div>
        </div>
        <div class="card">
          <input id="repoSearch" placeholder="Repo suchen" oninput="renderRepoList()">
          <div id="repoList" style="margin-top:10px"></div>
        </div>
      </aside>
      <main class="main">
        ${state.message ? `<div class="success">${escapeHtml(state.message)}</div>` : ''}
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}
        <div id="mainContent"></div>
      </main>
    </div>`;
  renderRepoList();
  renderMain();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login">
      <h1>Chief Developer Hub</h1>
      <p class="meta">Login mit dem Admin-Passwort aus deiner .env.</p>
      <div class="stack">
        <input id="password" type="password" placeholder="Admin-Passwort" onkeydown="if(event.key==='Enter') login()">
        <button onclick="login()">Einloggen</button>
      </div>
      ${state.error ? `<div class="error" style="margin-top:12px">${escapeHtml(state.error)}</div>` : ''}
    </div>`;
}

async function login() {
  try {
    state.error = '';
    const password = document.getElementById('password').value;
    const data = await api('/api/login', { method:'POST', body:JSON.stringify({ password }) });
    state.session = data.session;
    state.settings = data.settings;
    localStorage.setItem('dh_session', state.session);
    await loadProjects(false);
    render();
  } catch(e) { state.error = e.message; renderLogin(); }
}

async function saveToken() {
  try {
    const token = document.getElementById('tokenInput').value.trim();
    const data = await api('/api/github/token', { method:'POST', body:JSON.stringify({ token }) });
    state.settings = data.settings;
    state.message = 'GitHub Token gespeichert.';
    state.error = '';
    render();
  } catch(e) { showError(e); }
}

function renderAiProviderOptions() {
  const providers = state.settings?.aiProviders || { gemini:{label:'Google Gemini', defaultModel:'gemini-1.5-flash'}, openai:{label:'OpenAI', defaultModel:'gpt-4.1-mini'}, groq:{label:'Groq', defaultModel:'llama-3.3-70b-versatile'}, openrouter:{label:'OpenRouter', defaultModel:'deepseek/deepseek-chat-v3.1:free'}, mistral:{label:'Mistral', defaultModel:'mistral-small-latest'} };
  const current = state.settings?.aiProvider || 'gemini';
  return Object.entries(providers).map(([key, info]) => `<option value="${escapeAttr(key)}" ${key===current?'selected':''}>${escapeHtml(info.label)}</option>`).join('');
}

function getCurrentAiModel() {
  const provider = state.settings?.aiProvider || 'gemini';
  const providers = state.settings?.aiProviders || {};
  return state.settings?.aiModels?.[provider] || providers?.[provider]?.defaultModel || '';
}

function renderAiKeyStatus() {
  const provider = state.settings?.aiProvider || 'gemini';
  const providers = state.settings?.aiProviders || {};
  const label = providers?.[provider]?.label || provider;
  const hasKey = Boolean(state.settings?.aiKeys?.[provider]);
  return `${escapeHtml(label)}: ${hasKey ? 'API Key gespeichert' : 'noch kein Key gespeichert'}`;
}

function fillAiModelDefault() {
  const provider = document.getElementById('aiProvider')?.value || 'gemini';
  const providers = state.settings?.aiProviders || {};
  const model = state.settings?.aiModels?.[provider] || providers?.[provider]?.defaultModel || '';
  const input = document.getElementById('aiModel');
  if (input) input.value = model;
}

async function saveAiProviderAndKey() {
  try {
    const provider = document.getElementById('aiProvider').value;
    const model = document.getElementById('aiModel').value.trim();
    const key = document.getElementById('aiKeyInput').value.trim();
    let data = await api('/api/ai/settings', { method:'POST', body:JSON.stringify({ provider, model }) });
    if (key) data = await api('/api/ai/key', { method:'POST', body:JSON.stringify({ provider, key }) });
    state.settings = data.settings;
    state.message = 'KI-Anbieter gespeichert.';
    state.error = '';
    render();
  } catch(e) { showError(e); }
}

async function saveOpenAiKey() {
  try {
    const key = document.getElementById('aiKeyInput')?.value.trim() || '';
    const data = await api('/api/openai/key', { method:'POST', body:JSON.stringify({ key }) });
    state.settings = data.settings;
    state.message = 'OpenAI API Key gespeichert.';
    state.error = '';
    render();
  } catch(e) { showError(e); }
}

async function loadRepos() {
  try {
    state.message = 'Repositories werden geladen...'; state.error = ''; render();
    state.repos = await api('/api/github/repos');
    state.message = `${state.repos.length} Repositories geladen.`;
    render();
  } catch(e) { showError(e); }
}

async function loadProjects(doRender = true) {
  try {
    const data = await api('/api/projects');
    state.projects = data.projects || [];
    state.resources = data.resources || [];
    if (doRender) render();
  } catch(e) { if (doRender) showError(e); }
}

function renderRepoList() {
  const el = document.getElementById('repoList');
  if (!el) return;
  const q = (document.getElementById('repoSearch')?.value || '').toLowerCase();
  const repos = state.repos.filter(r => !q || r.fullName.toLowerCase().includes(q)).slice(0, 100);
  el.innerHTML = repos.map(r => `<div class="repo ${state.selectedRepo === r.fullName ? 'active' : ''}" onclick="selectRepo('${escapeAttr(r.fullName)}')">
    <strong>${escapeHtml(r.name)}</strong><br><span class="meta">${escapeHtml(r.fullName)}</span>
  </div>`).join('') || '<div class="meta">Noch keine Repos geladen.</div>';
}

async function selectRepo(fullName) {
  state.selectedRepo = fullName;
  state.globalView = 'project';
  state.scan = null;
  state.aiEstimate = null;
  state.tab = 'overview';
  render();
  try {
    const [owner, repo] = fullName.split('/');
    state.scan = await api(`/api/projects/${owner}/${repo}/scan`);
    state.aiEstimate = null;
    render();
  } catch(e) {
    state.error = 'Noch kein Scan vorhanden. Bitte scannen.';
    render();
  }
}

function renderMain() {
  const el = document.getElementById('mainContent');
  if (!el) return;
  if (state.globalView === 'server') { el.innerHTML = renderServerInventory(); return; }
  if (state.globalView === 'firebase') { el.innerHTML = renderFirebaseInventory(); return; }
  if (!state.selectedRepo) {
    el.innerHTML = renderDashboard();
    return;
  }
  const scan = state.scan;
  el.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <h1 style="margin:0">${escapeHtml(state.selectedRepo)}</h1>
          <div class="meta">${scan ? `Scanner: ${escapeHtml(scan.scannerVersion)} · ${escapeHtml(scan.scannedAt)}` : 'Noch nicht gescannt'}</div>
        </div>
        <div class="row">
          <button onclick="scanRepo()">Projekt scannen</button>
          <button class="secondary" onclick="loadScan()">Scan neu laden</button>
        </div>
      </div>
    </div>
    ${scan ? renderProject(scan) : `<div class="notice">Noch kein Scan. Klicke auf Projekt scannen.</div>`}`;
}

function renderDashboard() {
  return `
    <div class="grid">
      <div class="card"><h2>Projekte</h2><div class="meta">${state.projects.length} gespeicherte Projekte</div></div>
      <div class="card"><h2>Ressourcen</h2><div class="meta">${state.resources.length} erkannte Ressourcen</div></div>
      <div class="card"><h2>Scanner</h2><div class="meta">Echte Datei-Inventur, AST, HTML, JSON, Firebase-Regeln und Debug-Belege.</div></div>
    </div>
    <div class="card">
      <h2>Projektgruppen</h2>
      ${Object.entries(GROUPS).map(([k,v]) => `<span class="pill">${escapeHtml(v)}</span>`).join('')}
    </div>
    <div class="card">
      <h2>Ressourcen-Graph</h2>
      ${state.resources.length ? `<table class="table"><tr><th>Typ</th><th>Wert</th><th>Projekte</th></tr>${state.resources.slice(0,80).map(r => `<tr><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.value)}</td><td>${escapeHtml((r.projects||[]).join(', '))}</td></tr>`).join('')}</table>` : '<div class="meta">Noch keine Ressourcen erkannt.</div>'}
    </div>`;
}


async function showServerInventory() {
  try {
    state.globalView = 'server';
    state.selectedRepo = '';
    state.message = 'Server-Inventar wird geladen...';
    state.error = '';
    render();
    state.serverInventory = await api('/api/server/inventory');
    const serverDocsData = await api('/api/server/docs');
    const serverAiData = await api('/api/server/ai');
    state.serverDocs = serverDocsData.docs || [];
    state.serverAiAnalyses = serverAiData.analyses || [];
    state.message = 'Server-Inventar geladen.';
    render();
  } catch(e) { showError(e); }
}

async function showFirebaseInventory() {
  try {
    state.globalView = 'firebase';
    state.selectedRepo = '';
    state.message = 'Firebase-Übersicht wird geladen...';
    state.error = '';
    render();
    state.firebaseAggregate = await api('/api/firebase/aggregate');
    state.message = 'Firebase-Übersicht geladen.';
    render();
  } catch(e) { showError(e); }
}


function findServerAiFor({ path, unit }) {
  return (state.serverAiAnalyses || []).find(a => (unit && a.unit === unit) || (path && a.path === path)) || null;
}

function renderServerAiSummary(row) {
  if (!row?.analysis) return '<span class="pill warn">Noch keine KI-Analyse</span>';
  const ai = row.analysis;
  return `<span class="pill ok">KI: ${escapeHtml(ai.kind || ai.model || 'analysiert')}</span><div class="meta">${escapeHtml(ai.purpose || '')}</div>`;
}

function serverAiButtons({ path, unit, label }) {
  const target = encodeURIComponent(JSON.stringify({ path:path || '', unit:unit || '', label:label || '' }));
  return `<button class="secondary" onclick="estimateServerAi('${target}')">KI-Kosten</button><button onclick="runServerAi('${target}')">Server-KI analysieren</button>`;
}

function renderServerInventory() {
  const inv = state.serverInventory;
  const docs = state.serverDocs || [];
  if (!inv) return `<div class="card"><h1>Server & Bots</h1><p class="meta">Noch nicht geladen.</p><button onclick="showServerInventory()">Server scannen</button></div>`;
  const botServices = (inv.services || []).filter(s => /bot|watch|telegram|dashboard|hub|product|display|ofcs|jp/i.test(`${s.unit} ${s.description} ${s.execStart} ${s.workingDirectory}`));
  return `
    <div class="card"><div class="row" style="justify-content:space-between"><div><h1>Server & Bots</h1><div class="meta">Host: ${escapeHtml(inv.host || '')} · OS: ${escapeHtml(inv.os || '')} · IP: ${escapeHtml(inv.publicIp || (inv.ips||[]).join(', '))} · Scan: ${escapeHtml(inv.scannedAt || '')}</div></div><button onclick="showServerInventory()">Neu scannen</button></div></div>
    <div class="grid">
      <div class="card"><h2>Serverdaten</h2><div class="kv"><b>Host</b><span>${escapeHtml(inv.host||'')}</span></div><div class="kv"><b>IP(s)</b><span>${escapeHtml((inv.ips||[]).join(', ')||'')}</span></div><div class="kv"><b>OS</b><span>${escapeHtml(inv.os||'')}</span></div></div>
      <div class="card"><h2>Services</h2><div class="kv"><b>Systemd Services</b><span>${(inv.services||[]).length}</span></div><div class="kv"><b>relevant erkannt</b><span>${botServices.length}</span></div></div>
      <div class="card"><h2>/opt Projekte</h2><div class="kv"><b>Ordner</b><span>${(inv.optProjects||[]).length}</span></div></div>
    </div>
    <div class="card"><h2>Manuelle Server-Doku</h2><p class="meta">Hier speicherst du IP, Anbieter, SSH, Services, Projektpfade und Hinweise dauerhaft. Diese Infos landen später im ChatGPT-Kontext.</p>
      <div class="grid"><input id="serverKey" placeholder="Schlüssel, z. B. main-vps" value="main-vps"><input id="serverName" placeholder="Name" value="My VPS"><input id="serverProvider" placeholder="Anbieter" value="IONOS"><input id="serverIp" placeholder="IP" value="${escapeAttr(inv.publicIp || '')}"><input id="serverDomain" placeholder="Domain/Subdomain"><input id="serverSshUser" placeholder="SSH User" value="root"><input id="serverSshPort" placeholder="SSH Port" value="22"><input id="serverOs" placeholder="OS" value="${escapeAttr(inv.os || '')}"></div>
      <textarea id="serverProjectPaths" placeholder="Projektpfade, einer pro Zeile">${escapeHtml((inv.optProjects||[]).map(p=>p.path).join('\n'))}</textarea>
      <textarea id="serverServices" placeholder="Wichtige Services, einer pro Zeile">${escapeHtml(botServices.map(s=>s.unit).join('\n'))}</textarea>
      <textarea id="serverNotes" placeholder="Hinweise, Startbefehle, Besonderheiten, was ChatGPT wissen muss"></textarea>
      <button onclick="saveServerDoc()">Server-Doku speichern</button>
      ${docs.map(d=>`<div class="fact"><strong>${escapeHtml(d.name || d.key)}</strong><div class="meta">${escapeHtml(d.provider||'')} · ${escapeHtml(d.ip||'')} · SSH ${escapeHtml(d.sshUser||'root')}@${escapeHtml(d.ip||'')}${d.sshPort?':'+escapeHtml(d.sshPort):''}</div><div>${escapeHtml(d.notes||'')}</div></div>`).join('')}
    </div>
    <div class="card"><h2>So arbeitest du an einem Server-Projekt weiter</h2><p class="meta">Wähle unten den passenden Service oder Ordner. Kopiere den Kontext in einen neuen Chat. Der Prompt enthält IP, SSH, Pfad, Startbefehl, Logs und Schutzregeln.</p><div class="notice">Wichtig: Server-Projekte sind nicht automatisch GitHub-Repos im Hub. Der Hub zeigt dir deshalb den Server-Pfad, zugehörige systemd-Services und die Befehle, die du für Änderungen brauchst.</div></div>
    <div class="card"><h2>Erkannte Bots, Watcher und Dashboards</h2>${botServices.length ? botServices.map(s => `<div class="fact"><div class="fact-head"><div><strong>${escapeHtml(s.unit)}</strong><div class="meta">${escapeHtml(inferServiceKind(s))} · ${escapeHtml(s.description||'')} · ${escapeHtml(s.active||'')} · Autostart: ${escapeHtml(s.enabled||'')}</div></div><div class="row">${copyButton('Kontext kopieren', buildServiceContext(s, inv, docs, findServerAiFor({unit:s.unit, path:s.workingDirectory}))) }${copyButton('Befehle kopieren', buildServiceCommands(s))}${serverAiButtons({unit:s.unit, path:s.workingDirectory, label:s.unit})}</div></div><div class="kv"><b>Arbeitsordner</b><span>${escapeHtml(s.workingDirectory||'')}</span></div><div class="kv"><b>Startbefehl</b><span><code>${escapeHtml(s.execStart||'')}</code></span></div><div class="kv"><b>Stack</b><span>${(s.stack||[]).map(x=>`<span class="pill">${escapeHtml(x)}</span>`).join('') || '<span class="meta">nicht erkannt</span>'}</span></div><div class="kv"><b>KI-Analyse</b><span>${renderServerAiSummary(findServerAiFor({unit:s.unit, path:s.workingDirectory}))}</span></div><details><summary>Letzte Logs und Befehle anzeigen</summary><h4>Logs</h4>${renderCommandBlock((s.logs||[]).join('\n') || 'Keine Logs geladen.')}<h4>Befehle</h4>${renderCommandBlock(buildServiceCommands(s))}</details></div>`).join('') : '<div class="meta">Keine relevanten Services erkannt.</div>'}</div>
    <div class="card"><h2>Server-Projekte unter /opt</h2>${(inv.optProjects||[]).length ? (inv.optProjects||[]).map(p => { const related = (inv.services||[]).filter(s => s.workingDirectory && p.path && s.workingDirectory.startsWith(p.path)); return `<div class="fact"><div class="fact-head"><div><strong>${escapeHtml(p.name)}</strong><div class="meta">${escapeHtml(p.path)} · ${(p.stack||[]).join(', ') || 'Stack nicht erkannt'}</div></div><div class="row">${copyButton('Projektkontext kopieren', buildProjectContext(p, inv, docs, related, findServerAiFor({path:p.path, unit:related[0]?.unit}))) }${copyButton('Befehle kopieren', buildProjectCommands(p))}${serverAiButtons({path:p.path, unit:related[0]?.unit || '', label:p.name})}</div></div><div class="kv"><b>Git Remote</b><span>${escapeHtml(p.gitRemote||'')}</span></div><div class="kv"><b>Zugehörige Services</b><span>${related.length ? related.map(s=>`<span class="pill">${escapeHtml(s.unit)}</span>`).join('') : '<span class="meta">keine erkannt</span>'}</span></div><div class="kv"><b>KI-Analyse</b><span>${renderServerAiSummary(findServerAiFor({path:p.path, unit:related[0]?.unit}))}</span></div><details><summary>Befehle anzeigen</summary>${renderCommandBlock(buildProjectCommands(p))}</details></div>`; }).join('') : '<div class="meta">Keine /opt-Projekte erkannt.</div>'}</div>
    <div class="card"><h2>Gespeicherte Server-KI-Analysen</h2>${(state.serverAiAnalyses||[]).length ? (state.serverAiAnalyses||[]).map(row => `<div class="fact"><div class="fact-head"><div><strong>${escapeHtml(row.name || row.unit || row.path)}</strong><div class="meta">${escapeHtml(row.unit||'')} · ${escapeHtml(row.path||'')} · ${escapeHtml(row.updatedAt||'')}</div></div>${copyButton('KI-Kontext kopieren', row.analysis?.chatgptContext || '')}</div><p>${escapeHtml(row.analysis?.purpose || '')}</p><details><summary>Analyse anzeigen</summary><pre>${escapeHtml(JSON.stringify(row.analysis, null, 2))}</pre></details></div>`).join('') : '<div class="meta">Noch keine Server-KI-Analyse gespeichert.</div>'}</div>
    <div class="card"><h2>Laufende Ports</h2>${(inv.listeners||[]).map(x => `<div class="snippet">${escapeHtml(x)}</div>`).join('')}</div>`
}

async function saveServerDoc() {
  try {
    const body = {
      key: document.getElementById('serverKey').value.trim(),
      name: document.getElementById('serverName').value.trim(),
      provider: document.getElementById('serverProvider').value.trim(),
      ip: document.getElementById('serverIp').value.trim(),
      domain: document.getElementById('serverDomain').value.trim(),
      sshUser: document.getElementById('serverSshUser').value.trim(),
      sshPort: document.getElementById('serverSshPort').value.trim(),
      os: document.getElementById('serverOs').value.trim(),
      projectPaths: document.getElementById('serverProjectPaths').value,
      services: document.getElementById('serverServices').value,
      notes: document.getElementById('serverNotes').value.trim()
    };
    const data = await api('/api/server/docs', { method:'POST', body:JSON.stringify(body) });
    state.serverDocs = data.docs || [];
    state.message = 'Server-Doku gespeichert.';
    render();
  } catch(e) { showError(e); }
}


async function estimateServerAi(encodedTarget) {
  try {
    const target = JSON.parse(decodeURIComponent(encodedTarget));
    const params = new URLSearchParams({ provider: state.settings?.aiProvider || '', model: getCurrentAiModel() || '', path: target.path || '', unit: target.unit || '' });
    state.message = 'Server-KI-Kosten werden geschätzt...'; state.error=''; render();
    const estimate = await api(`/api/server/project/ai/estimate?${params.toString()}`);
    state.serverAiEstimate = estimate;
    const msg = `Server-KI-Schätzung für ${target.label || target.unit || target.path}\n\nDateien: ${estimate.filesIncluded}\nInput: ${estimate.inputTokensEstimated} Tokens\nOutput geschätzt: ${estimate.outputTokensEstimated} Tokens\nKosten: ${estimate.estimatedCostLabel || 'nicht berechnet'}`;
    alert(msg);
    state.message = 'Server-KI-Kosten geschätzt.'; render();
  } catch(e) { showError(e); }
}

async function runServerAi(encodedTarget) {
  try {
    const target = JSON.parse(decodeURIComponent(encodedTarget));
    const params = new URLSearchParams({ provider: state.settings?.aiProvider || '', model: getCurrentAiModel() || '', path: target.path || '', unit: target.unit || '' });
    const estimate = await api(`/api/server/project/ai/estimate?${params.toString()}`);
    const msg = `Server-KI-Analyse starten?\n\nProjekt: ${target.label || target.unit || target.path}\nDateien: ${estimate.filesIncluded}\nInput: ${estimate.inputTokensEstimated} Tokens\nKosten: ${estimate.estimatedCostLabel || 'nicht berechnet'}\n\nDiese Analyse wird gespeichert und später im Kontext verwendet.`;
    if (!confirm(msg)) return;
    state.message = 'Server-Projekt wird per KI analysiert...'; state.error=''; render();
    const data = await api('/api/server/project/ai/analyze', { method:'POST', body: JSON.stringify({ provider:state.settings?.aiProvider, model:getCurrentAiModel(), path:target.path || '', unit:target.unit || '' }) });
    state.serverAiAnalyses = data.analyses || [];
    state.message = 'Server-KI-Analyse gespeichert.';
    await showServerInventory();
  } catch(e) { showError(e); }
}

function renderFirebaseInventory() {
  const fb = state.firebaseAggregate;
  if (!fb) return `<div class="card"><h1>Firebase</h1><p class="meta">Noch nicht geladen.</p><button onclick="showFirebaseInventory()">Firebase-Übersicht laden</button></div>`;
  const resources = fb.resources || [];
  const docs = fb.docs || [];
  const rules = [];
  for (const d of docs) for (const p of (d.parsedRules?.paths || [])) rules.push({ doc:d, path:p, rw:(d.parsedRules?.readWrite||[]).filter(r=>r.path===p) });
  const byType = resources.reduce((m,r)=>{m[r.type]=(m[r.type]||0)+1; return m;},{});
  return `
    <div class="card"><div class="row" style="justify-content:space-between"><div><h1>Firebase</h1><div class="meta">Gespeicherte Firebase-Infos, Regeln und aus Repos erkannte Ressourcen.</div></div><button onclick="showFirebaseInventory()">Neu laden</button></div></div>
    <div class="grid">
      <div class="card"><h2>Ressourcen aus Scans</h2>${Object.entries(byType).map(([k,v]) => `<div class="kv"><b>${escapeHtml(k)}</b><span>${v}</span></div>`).join('') || '<div class="meta">Keine erkannt.</div>'}</div>
      <div class="card"><h2>Gespeicherte Firebase-Projekte</h2><div class="kv"><b>Einträge</b><span>${docs.length}</span></div><div class="kv"><b>organisierte Rules-Pfade</b><span>${rules.length}</span></div></div>
      <div class="card"><h2>Wichtig</h2><p class="meta">Firebase-Projektname ist nur Ressource. Projektzweck kommt aus Code und KI-Analyse. Rules werden nach Pfaden sortiert und in den Kontext übernommen.</p></div>
    </div>
    <div class="card"><h2>Firebase-Projekt speichern</h2>
      <div class="grid"><input id="fbKey" placeholder="Schlüssel, z. B. queue-tracker-3fa3c"><input id="fbLabel" placeholder="Name, z. B. gemeinsame Realtime DB"><input id="fbProjectId" placeholder="Firebase Project ID"><input id="fbDatabaseUrl" placeholder="Realtime Database URL"><input id="fbAuthDomain" placeholder="Auth Domain"><input id="fbStorageBucket" placeholder="Storage Bucket"><input id="fbOwnerAccount" placeholder="Firebase Account / User"><input id="fbConsoleUrl" placeholder="Firebase Console URL"></div>
      <textarea id="fbUsers" placeholder="Weitere Firebase User, einer pro Zeile"></textarea>
      <textarea id="fbNotes" placeholder="Hinweise, Schutzregeln, geteilte Nutzung, was ChatGPT beachten muss"></textarea>
      <textarea id="fbRulesText" placeholder="Firebase Rules JSON hier einfügen. Der Hub organisiert daraus automatisch die Pfade und .read/.write-Regeln." style="min-height:180px"></textarea>
      <button onclick="saveFirebaseDoc()">Firebase-Doku und Rules speichern</button>
    </div>
    <div class="card"><h2>Gespeicherte Firebase-Projekte</h2>${docs.map(d=>`<div class="fact"><strong>${escapeHtml(d.label || d.key)}</strong><div class="meta">Projekt: ${escapeHtml(d.projectId||'-')} · DB: ${escapeHtml(d.databaseUrl||'-')} · Account: ${escapeHtml(d.ownerAccount||'-')}</div><div>${escapeHtml(d.notes||'')}</div><div class="meta">Rules-Pfade: ${escapeHtml((d.parsedRules?.paths||[]).join(', ') || 'keine')}</div></div>`).join('') || '<div class="meta">Noch keine manuelle Firebase-Doku gespeichert.</div>'}</div>
    <div class="card"><h2>Organisierte Rules</h2>${rules.length ? `<table class="table"><tr><th>Projekt</th><th>Pfad</th><th>Regeln</th></tr>${rules.map(r=>`<tr><td>${escapeHtml(r.doc.label||r.doc.key)}</td><td><code>${escapeHtml(r.path)}</code></td><td>${(r.rw||[]).map(x=>`<div class="snippet">read: ${escapeHtml(x.read||'')} write: ${escapeHtml(x.write||'')} ${x.rule?escapeHtml(x.rule):''}</div>`).join('')}</td></tr>`).join('')}</table>` : '<div class="meta">Keine Rules gespeichert oder erkannt.</div>'}</div>
    <div class="card"><h2>Erkannte Firebase-Ressourcen aus Repos</h2>${resources.length ? `<table class="table"><tr><th>Typ</th><th>Wert</th><th>Projekte</th><th>Belege</th></tr>${resources.map(r => `<tr><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.value)}</td><td>${escapeHtml((r.projects||[]).join(', '))}</td><td>${(r.evidence||[]).slice(0,4).map(e=>`<div class="snippet">${escapeHtml(e.repo||'')} ${escapeHtml(e.file||'')}${e.line?':'+e.line:''} ${escapeHtml(e.snippet||'')}</div>`).join('')}</td></tr>`).join('')}</table>` : '<div class="meta">Noch keine Firebase-Ressourcen erkannt. Scanne zuerst alle Repos.</div>'}</div>`;
}

async function saveFirebaseDoc() {
  try {
    const body = {
      key: document.getElementById('fbKey').value.trim(),
      label: document.getElementById('fbLabel').value.trim(),
      projectId: document.getElementById('fbProjectId').value.trim(),
      databaseUrl: document.getElementById('fbDatabaseUrl').value.trim(),
      authDomain: document.getElementById('fbAuthDomain').value.trim(),
      storageBucket: document.getElementById('fbStorageBucket').value.trim(),
      ownerAccount: document.getElementById('fbOwnerAccount').value.trim(),
      consoleUrl: document.getElementById('fbConsoleUrl').value.trim(),
      firebaseUsers: document.getElementById('fbUsers').value,
      notes: document.getElementById('fbNotes').value.trim(),
      rulesText: document.getElementById('fbRulesText').value
    };
    if (!body.key && !body.projectId && !body.databaseUrl) throw new Error('Bitte Schlüssel, Projekt-ID oder Datenbank-URL eintragen.');
    state.firebaseAggregate = await api('/api/firebase/docs', { method:'POST', body:JSON.stringify(body) });
    state.message = 'Firebase-Doku und Rules gespeichert.';
    await showFirebaseInventory();
  } catch(e) { showError(e); }
}

function renderProject(scan) {
  const tabs = ['overview','wiki','chatgpt','ai','debug','facts','files','deploy','notes','secrets'];
  const names = { overview:'Übersicht', wiki:'Wiki', chatgpt:'ChatGPT', ai:'KI-Analyse', debug:'Scanner Debug', facts:'Code-Fakten', files:'Dateien', deploy:'Deploy', notes:'Notizen', secrets:'Secrets' };
  return `
    <div class="tabs">${tabs.map(t => `<button class="tab ${state.tab===t?'active':''}" onclick="setTab('${t}')">${names[t]}</button>`).join('')}</div>
    <div>${renderTab(scan)}</div>`;
}

function renderTab(scan) {
  if (state.tab === 'overview') return renderOverview(scan);
  if (state.tab === 'wiki') return `<div class="card"><div class="row"><button onclick="copyText(${JSON.stringify(scan.wiki)})">Wiki kopieren</button></div><pre>${escapeHtml(scan.wiki)}</pre></div>`;
  if (state.tab === 'chatgpt') return `<div class="card"><div class="row"><button onclick="copyText(${JSON.stringify(scan.chatgptContext)})">Kontext kopieren</button></div><pre>${escapeHtml(scan.chatgptContext)}</pre></div>`;
  if (state.tab === 'ai') return renderAi(scan);
  if (state.tab === 'debug') return renderDebug(scan);
  if (state.tab === 'facts') return renderFacts(scan.facts || []);
  if (state.tab === 'files') return renderFiles(scan);
  if (state.tab === 'deploy') return renderDeploy(scan);
  if (state.tab === 'notes') return renderNotes(scan);
  if (state.tab === 'secrets') return renderSecrets();
  return '';
}

function renderOverview(scan) {
  const confidence = Math.round((scan.purpose?.confidence || 0) * 100);
  return `
    <div class="grid">
      <div class="card">
        <h2>Zweck</h2>
        <p>${escapeHtml(scan.purpose?.text || '')}</p>
        ${scan.ai ? `<span class="pill ok">KI analysiert: ${escapeHtml(scan.ai.model || '')}</span>` : `<span class="pill warn">Noch keine KI-Analyse</span>`}
        <div class="progress"><span style="width:${confidence}%"></span></div>
        <div class="meta">Sicherheit: ${confidence} % · Gruppe: ${escapeHtml(GROUPS[scan.projectGroup] || scan.projectGroup)}</div>
      </div>
      <div class="card"><h2>Inventar</h2><div class="kv"><b>Dateien</b><span>${scan.inventory.totalFiles}</span></div><div class="kv"><b>Gelesen</b><span>${scan.inventory.readFiles}</span></div><div class="kv"><b>Bytes</b><span>${scan.inventory.totalBytesRead}</span></div></div>
      <div class="card"><h2>Architektur</h2>${(scan.architecture||[]).map(a => `<span class="pill ok">${escapeHtml(a)}</span>`).join('') || '<div class="meta">Keine erkannt</div>'}</div>
    </div>
    ${scan.conflicts?.length ? `<div class="error"><b>Konflikte</b><br>${scan.conflicts.map(escapeHtml).join('<br>')}</div>` : ''}
    <div class="card"><h2>Ressourcen</h2>${(scan.resources||[]).map(r => `<span class="pill">${escapeHtml(r.label)}: ${escapeHtml(r.value)}</span>`).join('') || '<div class="meta">Keine Ressourcen erkannt.</div>'}</div>
    <div class="card"><h2>Scores</h2>${(scan.scores||[]).map(s => `<div class="kv"><b>${escapeHtml(s.label)}</b><span>${s.score}</span></div>`).join('')}</div>
    <div class="card"><h2>Wichtigste Belege</h2>${renderFactList((scan.purpose?.evidence || []).slice(0,10))}</div>`;
}


function renderAi(scan) {
  const ai = scan.ai;
  const current = Boolean(ai?.contentFingerprint && scan.contentFingerprint && ai.contentFingerprint === scan.contentFingerprint);
  const estimate = state.aiEstimate;
  const estimateHtml = estimate ? `
    <div class="card">
      <h2>Kostenschätzung</h2>
      <div class="kv"><b>Anbieter/Modell</b><span>${escapeHtml(estimate.providerLabel)} · ${escapeHtml(estimate.model)}</span></div>
      <div class="kv"><b>Modus</b><span>${estimate.mode === 'changed' ? 'nur geänderte Dateien' : 'Vollanalyse'}</span></div>
      <div class="kv"><b>Geschätzte Tokens</b><span>${escapeHtml(estimate.inputTokensEstimated)} input · ${escapeHtml(estimate.outputTokensEstimated)} output</span></div>
      <div class="kv"><b>Geschätzte Kosten</b><span>${escapeHtml(estimate.estimatedCostLabel || 'nicht berechnet')}</span></div>
      <div class="kv"><b>Dateien an KI</b><span>${escapeHtml(estimate.filesIncluded)} von ${escapeHtml(estimate.filesRead)} gelesenen Dateien</span></div>
      ${estimate.mode === 'changed' ? `<div class="meta">Geändert: ${(estimate.changedFiles||[]).slice(0,8).map(escapeHtml).join(', ') || 'keine'}${(estimate.changedFiles||[]).length>8?' …':''}</div>` : ''}
      <div class="meta">${escapeHtml(estimate.pricingNote || '')}</div>
    </div>` : '';
  const statusHtml = ai ? `<div class="card">
      <h2>Speicherstatus</h2>
      <p>${current ? '<span class="pill ok">Analyse ist aktuell</span>' : '<span class="pill warn">Code hat sich seit der KI-Analyse geändert oder Fingerprint fehlt</span>'}</p>
      <div class="meta">Letzte KI-Analyse: ${escapeHtml(ai.analyzedAt || 'unbekannt')}</div>
      <div class="meta">Kosten entstehen nur, wenn du eine neue KI-Analyse startest.</div>
    </div>` : '';
  const startCard = `<div class="card">
      <h2>KI-Codeanalyse</h2>
      <p class="meta">Die Analyse wird dauerhaft im Developer Hub gespeichert. Normales Öffnen, Lesen und Kontext-Kopieren kostet danach nichts.</p>
      <div class="row">
        <button onclick="estimateAiAnalysis('full')">Kosten schätzen</button>
        <button onclick="runAiAnalysis('full')">Vollanalyse starten</button>
        ${ai ? `<button class="secondary" onclick="estimateAiAnalysis('changed')">Delta schätzen</button><button class="secondary" onclick="runAiAnalysis('changed')">Nur geänderte Dateien analysieren</button>` : ''}
      </div>
      <div class="meta" style="margin-top:10px">Voraussetzung: KI-Anbieter und API Key links speichern.</div>
    </div>`;
  if (!ai) return `${startCard}${estimateHtml}`;
  return `${statusHtml}${startCard}${estimateHtml}
  <div class="grid">
    <div class="card"><h2>KI-Zweck</h2><p>${escapeHtml(ai.purpose)}</p><div class="meta">Sicherheit: ${Math.round((ai.confidence || 0) * 100)} % · Anbieter: ${escapeHtml(ai.providerLabel || ai.provider || '')} · Modell: ${escapeHtml(ai.model || '')}</div></div>
    <div class="card"><h2>Input</h2><div class="kv"><b>Dateien gelesen</b><span>${ai.inputStats?.filesRead || 0}</span></div><div class="kv"><b>KI-Korpus</b><span>${ai.inputStats?.corpusChars || 0} Zeichen</span></div><div class="kv"><b>Dateien an KI</b><span>${ai.inputStats?.includedFiles || 0}</span></div><div class="kv"><b>Modus</b><span>${escapeHtml(ai.inputStats?.mode || 'full')}</span></div></div>
  </div>
  <div class="card"><h2>Zusammenfassung</h2><p>${escapeHtml(ai.summary || '')}</p></div>
  <div class="card"><h2>Hauptfunktionen</h2>${(ai.mainFeatures||[]).map(x => `<div class="fact">${escapeHtml(x)}</div>`).join('') || '<div class="meta">Keine erkannt.</div>'}</div>
  <div class="card"><h2>Datenmodell</h2>${(ai.dataModel||[]).map(x => `<div class="fact">${escapeHtml(x)}</div>`).join('') || '<div class="meta">Keine erkannt.</div>'}</div>
  <div class="card"><h2>Firebase</h2><p>${escapeHtml(ai.firebase?.explanation || '')}</p><div class="meta">Feste Pfade: ${(ai.firebase?.fixedPaths||[]).map(escapeHtml).join(', ') || 'keine'}<br>Dynamische Pfade: ${(ai.firebase?.dynamicPaths||[]).map(escapeHtml).join(', ') || 'keine'}</div></div>
  <div class="card"><h2>Belege</h2>${(ai.evidence||[]).map(e => `<div class="fact"><strong>${escapeHtml(e.file)}:${escapeHtml(e.line)}</strong><div>${escapeHtml(e.finding)}</div><div class="snippet">${escapeHtml(e.snippet)}</div></div>`).join('')}</div>
  <div class="card"><h2>Regeln und Risiken</h2><h3>Risiken</h3>${(ai.risks||[]).map(x => `<div class="fact">${escapeHtml(x)}</div>`).join('') || '<div class="meta">Keine.</div>'}<h3>Guardrails</h3>${(ai.guardrails||[]).map(x => `<div class="fact">${escapeHtml(x)}</div>`).join('')}</div>
  <div class="card"><h2>Aktionen</h2><button class="secondary" onclick="copyText(${JSON.stringify(ai.chatgptContext || '')})">KI-Kontext kopieren</button></div>`;
}

async function estimateAiAnalysis(mode = 'full') {
  try {
    state.message = 'Kostenschätzung wird berechnet...';
    state.error = '';
    render();
    const [owner, repo] = state.selectedRepo.split('/');
    const params = new URLSearchParams({ provider: state.settings?.aiProvider || '', model: getCurrentAiModel() || '', mode });
    state.aiEstimate = await api(`/api/projects/${owner}/${repo}/ai/estimate?${params.toString()}`);
    state.tab = 'ai';
    state.message = 'Kostenschätzung geladen.';
    render();
  } catch(e) { showError(e); }
}

async function runAiAnalysis(mode = 'full') {
  try {
    const [owner, repo] = state.selectedRepo.split('/');
    const params = new URLSearchParams({ provider: state.settings?.aiProvider || '', model: getCurrentAiModel() || '', mode });
    const estimate = await api(`/api/projects/${owner}/${repo}/ai/estimate?${params.toString()}`);
    state.aiEstimate = estimate;
    render();
    if (estimate.current && mode === 'full') {
      const ok = confirm('Die gespeicherte KI-Analyse ist laut Fingerprint bereits aktuell. Trotzdem neu analysieren?');
      if (!ok) return;
    }
    const msg = `KI-Analyse starten?\n\nModus: ${estimate.mode}\nGeschätzte Kosten: ${estimate.estimatedCostLabel || 'nicht berechnet'}\nInput: ${estimate.inputTokensEstimated} Tokens\nOutput geschätzt: ${estimate.outputTokensEstimated} Tokens`;
    if (!confirm(msg)) return;
    state.message = 'KI analysiert den gelesenen Code. Große Repos können länger dauern...';
    state.error = '';
    render();
    const data = await api(`/api/projects/${owner}/${repo}/ai/analyze`, { method:'POST', body:JSON.stringify({ provider:state.settings?.aiProvider, model:getCurrentAiModel(), mode }) });
    state.scan = data.scan;
    state.aiEstimate = null;
    state.tab = 'ai';
    state.message = data.ai?.reused ? 'KI-Analyse war bereits aktuell.' : 'KI-Analyse fertig und gespeichert.';
    await loadProjects(false);
    render();
  } catch(e) { showError(e); }
}

function renderDebug(scan) {
  const d = scan.debug || {};
  return `
    <div class="notice">${escapeHtml(d.proof || '')}</div>
    <div class="grid">
      <div class="card"><h2>Dateien gelesen</h2><pre>${escapeHtml(JSON.stringify(d.fileReadSummary, null, 2))}</pre></div>
      <div class="card"><h2>Parser</h2><pre>${escapeHtml(JSON.stringify(d.parserSummary, null, 2))}</pre></div>
    </div>
    <div class="card"><h2>Score-Belege</h2><pre>${escapeHtml(JSON.stringify(d.scores, null, 2))}</pre></div>
    <div class="card"><h2>Top Fakten</h2>${renderFactList(d.topFacts || [])}</div>`;
}

function renderFacts(facts) { return `<div class="card"><h2>${facts.length} Code-Fakten</h2>${renderFactList(facts)}</div>`; }

function renderFactList(facts) {
  return facts.map(f => `<div class="fact">
    <div class="fact-head"><strong>${escapeHtml(f.category)}/${escapeHtml(f.type)}</strong><span class="pill">Stärke ${escapeHtml(f.strength || '')}</span></div>
    <div>${escapeHtml(f.value || '')}</div>
    <div class="meta">${escapeHtml(f.file || '')}${f.line ? `:${f.line}` : ''} · ${escapeHtml(f.reason || '')}</div>
    ${f.snippet ? `<div class="snippet">${escapeHtml(f.snippet)}</div>` : ''}
  </div>`).join('') || '<div class="meta">Keine Fakten.</div>';
}

function renderFiles(scan) {
  const files = scan.inventory.files || [];
  return `<div class="card"><h2>Datei-Inventar</h2><table class="table"><tr><th>Datei</th><th>Sprache</th><th>Zeilen</th><th>Status</th></tr>${files.slice(0,500).map(f => `<tr><td>${escapeHtml(f.path)}</td><td>${escapeHtml(f.language)}</td><td>${escapeHtml(f.lines || '')}</td><td>${f.read ? '<span class="pill ok">gelesen</span>' : `<span class="pill warn">${escapeHtml(f.skippedReason || 'übersprungen')}</span>`}</td></tr>`).join('')}</table></div>`;
}

function renderDeploy(scan) {
  return `<div class="card"><h2>ZIP Deploy</h2><p class="meta">Überschreibt Dateien aus der ZIP. Löscht keine vorhandenen Dateien. Speichert vorher einen Rollback-Punkt.</p><div class="row"><input id="zipFile" type="file" accept=".zip"><button onclick="deployZip()">ZIP deployen</button><button class="danger" onclick="rollback()">Letzten Upload rückgängig</button></div><div id="deployResult"></div></div>`;
}

function renderNotes(scan) {
  return `<div class="card"><h2>Projektgruppe</h2><select id="groupSelect">${Object.entries(GROUPS).map(([k,v]) => `<option value="${k}" ${scan.projectGroup===k?'selected':''}>${escapeHtml(v)}</option>`).join('')}</select><button style="margin-top:10px" onclick="saveGroup()">Gruppe speichern</button></div><div class="card"><h2>Notizen</h2><textarea id="noteText" placeholder="Projektwissen, Besonderheiten, Entscheidungen..."></textarea><button onclick="saveNote()">Notiz speichern</button></div>`;
}

function renderSecrets() {
  return `<div class="card"><h2>Secrets</h2><p class="meta">Werte werden serverseitig verschlüsselt gespeichert.</p><div class="grid"><input id="secretName" placeholder="Name"><input id="secretValue" placeholder="Wert" type="password"></div><button style="margin-top:10px" onclick="saveSecret()">Secret speichern</button><div id="secretList"></div></div>`;
}

function setTab(t) { state.tab = t; renderMain(); if (t === 'notes') loadNote(); if (t === 'secrets') loadSecrets(); }

async function scanRepo() {
  try {
    state.message = 'Scan läuft. Das kann je nach Repo etwas dauern...'; state.error = ''; render();
    const [owner, repo] = state.selectedRepo.split('/');
    state.scan = await api(`/api/projects/${owner}/${repo}/scan`, { method:'POST' });
    state.aiEstimate = null;
    state.message = 'Scan fertig.';
    await loadProjects(false);
    render();
  } catch(e) { showError(e); }
}

async function loadScan() {
  try {
    const [owner, repo] = state.selectedRepo.split('/');
    state.scan = await api(`/api/projects/${owner}/${repo}/scan`);
    state.aiEstimate = null;
    render();
  } catch(e) { showError(e); }
}

async function saveGroup() {
  try {
    const group = document.getElementById('groupSelect').value;
    await api('/api/projects/group', { method:'POST', body:JSON.stringify({ fullName:state.selectedRepo, group }) });
    state.scan.projectGroup = group;
    state.message = 'Projektgruppe gespeichert.'; render();
  } catch(e) { showError(e); }
}

async function loadNote() {
  try {
    const [owner, repo] = state.selectedRepo.split('/');
    const note = await api(`/api/projects/${owner}/${repo}/note`);
    const el = document.getElementById('noteText'); if (el) el.value = note.text || '';
  } catch {}
}
async function saveNote() {
  try {
    const [owner, repo] = state.selectedRepo.split('/');
    await api(`/api/projects/${owner}/${repo}/note`, { method:'POST', body:JSON.stringify({ text:document.getElementById('noteText').value }) });
    state.message = 'Notiz gespeichert.'; render();
  } catch(e) { showError(e); }
}

async function deployZip() {
  try {
    const file = document.getElementById('zipFile').files[0];
    if (!file) throw new Error('Bitte ZIP auswählen.');
    const fd = new FormData(); fd.append('zip', file);
    const [owner, repo] = state.selectedRepo.split('/');
    const data = await api(`/api/deploy/${owner}/${repo}/zip`, { method:'POST', body:fd });
    document.getElementById('deployResult').innerHTML = `<div class="success">${data.changed.length} Dateien geändert. Rollback: ${escapeHtml(data.rollbackSha)}</div>`;
  } catch(e) { document.getElementById('deployResult').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`; }
}
async function rollback() {
  try {
    if (!confirm('Letzten Upload wirklich rückgängig machen?')) return;
    const [owner, repo] = state.selectedRepo.split('/');
    const data = await api(`/api/deploy/${owner}/${repo}/rollback`, { method:'POST' });
    alert(`Rollback auf ${data.sha} ausgeführt.`);
  } catch(e) { alert(e.message); }
}

async function saveSecret() {
  try {
    await api('/api/secrets', { method:'POST', body:JSON.stringify({ name:document.getElementById('secretName').value, value:document.getElementById('secretValue').value }) });
    await loadSecrets();
  } catch(e) { showError(e); }
}
async function loadSecrets() {
  try {
    const list = await api('/api/secrets');
    const el = document.getElementById('secretList'); if (!el) return;
    el.innerHTML = list.map(s => `<div class="fact"><strong>${escapeHtml(s.name)}</strong><div class="meta">${escapeHtml(s.hint || '')} · ${escapeHtml(s.updatedAt || '')}</div></div>`).join('') || '<div class="meta">Keine Secrets.</div>';
  } catch(e) { showError(e); }
}



function inferServiceKind(service) {
  const hay = `${service?.unit || ''} ${service?.description || ''} ${service?.execStart || ''} ${service?.workingDirectory || ''}`.toLowerCase();
  if (/telegram|telegraf|bot/.test(hay)) return 'Bot';
  if (/watch|watcher|crawler|scrap|product|ofcs|playwright/.test(hay)) return 'Watcher';
  if (/dashboard|display|gunicorn|flask|fastapi|express|hub/.test(hay)) return 'Dashboard / Web-App';
  if (/nginx|proxy/.test(hay)) return 'Reverse Proxy';
  if (/firebase|sync/.test(hay)) return 'Firebase-Dienst';
  return 'Server-Service';
}

function renderCommandBlock(text) {
  const value = String(text || '').trim();
  return `<pre class="command-block"><code>${escapeHtml(value || 'Keine Befehle vorhanden.')}</code></pre>`;
}

function copyButton(label, text) {
  const encoded = encodeURIComponent(String(text || ''));
  return `<button class="secondary" onclick="copyText(decodeURIComponent('${encoded}'))">${escapeHtml(label)}</button>`;
}

function buildServiceCommands(service) {
  const unit = service?.unit || '';
  const dir = service?.workingDirectory || '';
  const lines = [];
  if (dir) lines.push(`cd ${dir}`);
  if (unit) {
    lines.push(`systemctl status ${unit} --no-pager`);
    lines.push(`journalctl -u ${unit} -n 120 --no-pager`);
    lines.push(`# Nach Änderungen neu starten:`);
    lines.push(`systemctl restart ${unit}`);
    lines.push(`systemctl status ${unit} --no-pager`);
  }
  return lines.join('\n') || 'Kein Service-Befehl erkannt.';
}

function buildProjectCommands(project) {
  const dir = project?.path || '';
  const lines = [];
  if (dir) lines.push(`cd ${dir}`);
  if (project?.gitRemote) {
    lines.push('git status');
    lines.push('git pull');
  }
  if ((project?.stack || []).includes('Node.js')) {
    lines.push('npm install --no-audit --no-fund');
  }
  if ((project?.stack || []).includes('Python')) {
    lines.push('source venv/bin/activate 2>/dev/null || true');
    lines.push('pip install -r requirements.txt 2>/dev/null || true');
  }
  lines.push('# Zugehörigen systemd-Service danach neu starten, falls vorhanden.');
  return lines.join('\n') || 'Kein Projekt-Befehl erkannt.';
}

function buildServiceContext(service, inventory, docs, aiRow = null) {
  const doc = (docs || [])[0] || {};
  return `Ich möchte an einem Server-Service weiterarbeiten.

Server:
- Host: ${inventory?.host || 'unbekannt'}
- IP: ${doc.ip || inventory?.publicIp || (inventory?.ips || []).join(', ') || 'unbekannt'}
- Anbieter: ${doc.provider || 'unbekannt'}
- SSH: ${doc.sshUser || 'root'}@${doc.ip || inventory?.publicIp || 'SERVER_IP'}${doc.sshPort ? ':' + doc.sshPort : ''}
- OS: ${doc.os || inventory?.os || 'unbekannt'}

Service:
- Unit: ${service?.unit || 'unbekannt'}
- Art: ${inferServiceKind(service)}
- Beschreibung: ${service?.description || ''}
- Status: ${service?.active || ''}
- Autostart: ${service?.enabled || ''}
- Arbeitsordner: ${service?.workingDirectory || 'nicht erkannt'}
- Startbefehl: ${service?.execStart || 'nicht erkannt'}
- Stack: ${(service?.stack || []).join(', ') || 'nicht erkannt'}

KI-Analyse:
${aiRow?.analysis?.chatgptContext || aiRow?.analysis?.summary || 'Noch keine Server-KI-Analyse vorhanden. Vor größeren Änderungen im Hub Server-KI analysieren.'}

Letzte Logs:
${(service?.logs || []).join('\n') || 'Keine Logs geladen.'}

Wichtige Regeln:
- Bestehende Services auf dem VPS nicht beschädigen.
- Vor Änderungen den Arbeitsordner und systemd-Service prüfen.
- Keine Secrets, Tokens oder .env-Inhalte in Antworten ausschreiben.
- Nach Änderungen den passenden Service neu starten und Status/Logs prüfen.

Hilfreiche Befehle:
${buildServiceCommands(service)}
`;
}

function buildProjectContext(project, inventory, docs, relatedServices = [], aiRow = null) {
  const doc = (docs || [])[0] || {};
  return `Ich möchte an einem Server-Projekt weiterarbeiten.

Server:
- Host: ${inventory?.host || 'unbekannt'}
- IP: ${doc.ip || inventory?.publicIp || (inventory?.ips || []).join(', ') || 'unbekannt'}
- Anbieter: ${doc.provider || 'unbekannt'}
- SSH: ${doc.sshUser || 'root'}@${doc.ip || inventory?.publicIp || 'SERVER_IP'}${doc.sshPort ? ':' + doc.sshPort : ''}
- OS: ${doc.os || inventory?.os || 'unbekannt'}

Projekt:
- Name: ${project?.name || 'unbekannt'}
- Pfad: ${project?.path || 'unbekannt'}
- Stack: ${(project?.stack || []).join(', ') || 'nicht erkannt'}
- Git Remote: ${project?.gitRemote || 'nicht erkannt'}

Zugehörige systemd-Services:
${relatedServices.length ? relatedServices.map(s => `- ${s.unit}: ${s.description || ''} (${s.active || ''})`).join('\n') : '- keine erkannt'}

KI-Analyse:
${aiRow?.analysis?.chatgptContext || aiRow?.analysis?.summary || 'Noch keine Server-KI-Analyse vorhanden. Vor größeren Änderungen im Hub Server-KI analysieren.'}

Wichtige Regeln:
- Projektpfad und zugehörige Services prüfen, bevor Änderungen gemacht werden.
- Keine anderen /opt-Projekte verändern.
- Keine Secrets, Tokens oder .env-Inhalte in Antworten ausschreiben.
- Nach Änderungen passende Services neu starten und Logs prüfen.

Hilfreiche Befehle:
${buildProjectCommands(project)}
`;
}

async function copyText(text) { await navigator.clipboard.writeText(text || ''); alert('Kopiert.'); }
function showError(e) { state.error = e.message; state.message = ''; render(); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

if (state.session) {
  api('/api/settings').then(s => { state.settings = s; return loadProjects(false); }).then(render).catch(() => { state.session=''; localStorage.removeItem('dh_session'); render(); });
} else render();

window.showServerInventory = showServerInventory; window.estimateServerAi = estimateServerAi; window.runServerAi = runServerAi; window.saveServerDoc = saveServerDoc; window.showFirebaseInventory = showFirebaseInventory; window.saveFirebaseDoc = saveFirebaseDoc; window.estimateAiAnalysis = estimateAiAnalysis; window.login = login; window.saveToken = saveToken; window.saveOpenAiKey = saveOpenAiKey; window.saveAiProviderAndKey = saveAiProviderAndKey; window.fillAiModelDefault = fillAiModelDefault; window.loadRepos = loadRepos; window.loadProjects = loadProjects; window.selectRepo = selectRepo; window.scanRepo = scanRepo; window.loadScan = loadScan; window.setTab = setTab; window.copyText = copyText; window.deployZip = deployZip; window.rollback = rollback; window.saveGroup = saveGroup; window.saveNote = saveNote; window.saveSecret = saveSecret; window.loadSecrets = loadSecrets; window.runAiAnalysis = runAiAnalysis; window.renderRepoList = renderRepoList;
