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
  aiEstimate: null
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

async function copyText(text) { await navigator.clipboard.writeText(text || ''); alert('Kopiert.'); }
function showError(e) { state.error = e.message; state.message = ''; render(); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

if (state.session) {
  api('/api/settings').then(s => { state.settings = s; return loadProjects(false); }).then(render).catch(() => { state.session=''; localStorage.removeItem('dh_session'); render(); });
} else render();

window.estimateAiAnalysis = estimateAiAnalysis; window.login = login; window.saveToken = saveToken; window.saveOpenAiKey = saveOpenAiKey; window.saveAiProviderAndKey = saveAiProviderAndKey; window.fillAiModelDefault = fillAiModelDefault; window.loadRepos = loadRepos; window.loadProjects = loadProjects; window.selectRepo = selectRepo; window.scanRepo = scanRepo; window.loadScan = loadScan; window.setTab = setTab; window.copyText = copyText; window.deployZip = deployZip; window.rollback = rollback; window.saveGroup = saveGroup; window.saveNote = saveNote; window.saveSecret = saveSecret; window.loadSecrets = loadSecrets; window.runAiAnalysis = runAiAnalysis; window.renderRepoList = renderRepoList;
