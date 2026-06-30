import { storage } from './core/storage.js';
import { showAlert, setLoading, downloadJson, copyText, escapeHtml } from './core/ui.js';
import { GitHubService } from './services/github.js';
import { analyzeRepository, pickFilesForScan } from './modules/analyzer.js';
import { generateContext } from './modules/contextGenerator.js';

const state = {
  token: storage.get('githubToken', ''),
  repos: storage.get('repos', []),
  projects: storage.get('projects', []),
  currentRepoFullName: storage.get('currentRepoFullName', '')
};

const $ = (selector) => document.querySelector(selector);

const viewMeta = {
  dashboard: ['Dashboard', 'Überblick über deine Projekte und den aktuellen Scan-Stand.'],
  github: ['GitHub', 'Repositories laden, auswählen und scannen.'],
  memory: ['Projektgedächtnis', 'Automatisch erkannte Projektdokumentation.'],
  context: ['ChatGPT-Kontext', 'Prompt für einen neuen Chat erzeugen.'],
  deploy: ['ZIP-Deploy', 'Vorbereitet für die nächste Ausbaustufe.'],
  firebase: ['Firebase', 'Gemeinsame Datenbanken und Regeln im Blick behalten.'],
  server: ['VPS & Bots', 'Später: Server, Bots, Logs und Neustarts.'],
  settings: ['Einstellungen', 'Lokale Daten verwalten.']
};

function saveState() {
  storage.set('githubToken', state.token);
  storage.set('repos', state.repos);
  storage.set('projects', state.projects);
  storage.set('currentRepoFullName', state.currentRepoFullName);
}

function github() {
  if (!state.token) throw new Error('Bitte zuerst GitHub Token speichern.');
  return new GitHubService(state.token);
}

function switchView(name) {
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.querySelector(`#${name}View`)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  $('#viewTitle').textContent = viewMeta[name]?.[0] || name;
  $('#viewSubtitle').textContent = viewMeta[name]?.[1] || '';
}

function selectedRepo() {
  const fullName = $('#repoSelect').value || state.currentRepoFullName;
  return state.repos.find((repo) => repo.full_name === fullName);
}

function renderStatus() {
  const tokenStatus = state.token ? '<span class="badge ok">gespeichert</span>' : '<span class="badge warn">fehlt</span>';
  const reposStatus = state.repos.length ? `<span class="badge ok">${state.repos.length}</span>` : '<span class="badge warn">keine</span>';
  const projectsStatus = state.projects.length ? `<span class="badge ok">${state.projects.length}</span>` : '<span class="badge warn">keine</span>';
  const shared = countSharedFirebase();
  $('#statusList').innerHTML = `
    <div class="status-item"><span>GitHub Token</span>${tokenStatus}</div>
    <div class="status-item"><span>Repositories geladen</span>${reposStatus}</div>
    <div class="status-item"><span>Gespeicherte Scans</span>${projectsStatus}</div>
    <div class="status-item"><span>Gemeinsame Firebase-Ressourcen</span><span class="badge ${shared ? 'warn' : 'ok'}">${shared}</span></div>
  `;
}

function countSharedFirebase() {
  const seen = new Map();
  state.projects.forEach((project) => {
    const ids = [...(project.analysis.firebase.projectIds || []), ...(project.analysis.firebase.dbUrls || [])];
    ids.forEach((id) => seen.set(id, (seen.get(id) || 0) + 1));
  });
  return [...seen.values()].filter((count) => count > 1).length;
}

function renderRepos() {
  const select = $('#repoSelect');
  select.innerHTML = state.repos.map((repo) => `<option value="${escapeHtml(repo.full_name)}" ${repo.full_name === state.currentRepoFullName ? 'selected' : ''}>${escapeHtml(repo.full_name)}</option>`).join('');
  $('#repoTable').innerHTML = state.repos.map((repo) => `
    <tr>
      <td><strong>${escapeHtml(repo.full_name)}</strong><br><span class="hint">${escapeHtml(repo.description || '')}</span></td>
      <td>${repo.private ? 'ja' : 'nein'}</td>
      <td>${escapeHtml(repo.language || '-')}</td>
      <td>${new Date(repo.updated_at).toLocaleDateString('de-DE')}</td>
      <td><button class="button small" data-select-repo="${escapeHtml(repo.full_name)}">Auswählen</button></td>
    </tr>
  `).join('');
  renderRepoMeta();
}

function renderRepoMeta() {
  const repo = selectedRepo();
  $('#repoMeta').innerHTML = repo ? `
    <div class="kv"><strong>Name</strong><span>${escapeHtml(repo.full_name)}</span></div>
    <div class="kv"><strong>Branch</strong><span>${escapeHtml(repo.default_branch)}</span></div>
    <div class="kv"><strong>GitHub Pages</strong><span>${repo.has_pages ? 'aktiv' : 'nicht laut API aktiv'}</span></div>
    <div class="kv"><strong>Aktualisiert</strong><span>${new Date(repo.updated_at).toLocaleString('de-DE')}</span></div>
  ` : 'Noch kein Repository ausgewählt.';
}

function renderProjects() {
  const cards = $('#projectCards');
  if (!state.projects.length) {
    cards.innerHTML = '<p class="hint">Noch kein Projekt gescannt.</p>';
  } else {
    cards.innerHTML = state.projects.map((project) => {
      const a = project.analysis;
      const tags = [
        ...(a.firebase.hits.length ? ['Firebase'] : []),
        ...(a.bots.length ? ['Bot/Server'] : []),
        ...(a.hosting.length ? ['Hosting'] : []),
        ...a.tech.slice(0, 3)
      ];
      return `<article class="project-card">
        <h4>${escapeHtml(a.fullName)}</h4>
        <p>${escapeHtml(a.description || 'Keine Beschreibung erkannt.')}</p>
        <div class="tag-list">${tags.map((tag) => `<span class="tag ${tag.includes('Firebase') ? 'firebase' : tag.includes('Bot') ? 'bot' : tag.includes('Hosting') ? 'pages' : ''}">${escapeHtml(tag)}</span>`).join('')}</div>
        <p class="hint">Scan: ${new Date(a.scannedAt).toLocaleString('de-DE')}</p>
        <button class="button small" data-open-memory="${escapeHtml(a.fullName)}">Öffnen</button>
      </article>`;
    }).join('');
  }
  renderProjectSelects();
  renderStatus();
  renderFirebaseSummary();
  renderServerSummary();
}

function renderProjectSelects() {
  const options = state.projects.map((project) => `<option value="${escapeHtml(project.fullName)}">${escapeHtml(project.fullName)}</option>`).join('');
  ['#memoryProjectSelect', '#contextProjectSelect'].forEach((selector) => {
    const select = $(selector);
    const old = select.value;
    select.innerHTML = options;
    if (old) select.value = old;
  });
  renderMemoryDetails();
}

function getProject(fullName) {
  return state.projects.find((project) => project.fullName === fullName) || state.projects[0];
}

function renderMemoryDetails() {
  const project = getProject($('#memoryProjectSelect').value);
  if (!project) {
    $('#memoryDetails').innerHTML = '<p class="hint">Noch kein Scan vorhanden.</p>';
    return;
  }
  const a = project.analysis;
  $('#memoryDetails').innerHTML = `
    <div class="memory-section"><h4>Überblick</h4>
      ${kv('Repository', a.htmlUrl)}${kv('Beschreibung', a.description || 'keine')}${kv('Branch', a.defaultBranch)}${kv('Dateien', a.fileCount)}${kv('GitHub Pages', a.pagesUrl || 'nicht sicher erkannt')}
    </div>
    <div class="memory-section"><h4>Technik</h4><div class="tag-list">${a.tech.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('') || 'keine erkannt'}</div></div>
    <div class="memory-section"><h4>Firebase</h4>${list(a.firebase.hits)}${kv('Projekt-IDs', a.firebase.projectIds.join(', ') || 'keine')}${kv('Database URLs', a.firebase.dbUrls.join(', ') || 'keine')}</div>
    <div class="memory-section"><h4>Bots, Server, Hosting</h4>${kv('Hosting', a.hosting.join('; ') || 'nicht sicher erkannt')}${kv('Bots/Server', a.bots.join('; ') || 'nicht sicher erkannt')}</div>
    <div class="memory-section"><h4>Wichtige Dateien</h4>${list(a.importantFiles)}</div>
    <div class="memory-section"><h4>Abhängigkeiten</h4>${list(a.dependencies.sharedFirebase.map((p) => `${p} teilt wahrscheinlich Firebase-Ressourcen`))}</div>
    <div class="memory-section"><h4>Schutzregeln</h4>${list(a.guardrails)}</div>
    <div class="memory-section"><h4>Projektgesundheit</h4>${a.health.map((h) => `<div class="status-item"><span>${escapeHtml(h.label)}</span><span class="badge ${h.status}">${h.status}</span></div>`).join('')}</div>
  `;
}

function kv(label, value) {
  return `<div class="kv"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`;
}

function list(items) {
  return items?.length ? `<ul class="clean-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="hint">Keine Einträge.</p>';
}

function renderFirebaseSummary() {
  const items = state.projects.filter((project) => project.analysis.firebase.hits.length);
  $('#firebaseSummary').innerHTML = items.length ? list(items.map((project) => `${project.fullName}: ${(project.analysis.firebase.projectIds || []).join(', ') || 'Firebase erkannt'}`)) : '<p class="hint">Noch keine Firebase-Projekte erkannt.</p>';
}

function renderServerSummary() {
  const items = state.projects.filter((project) => project.analysis.bots.length);
  $('#serverSummary').innerHTML = items.length ? list(items.map((project) => `${project.fullName}: ${project.analysis.bots.join('; ')}`)) : '<p class="hint">Noch keine Bot- oder Server-Hinweise erkannt.</p>';
}

async function loadRepos() {
  const button = $('#loadReposBtn');
  setLoading(button, true, 'Lade Repos...');
  try {
    const api = github();
    await api.getUser();
    state.repos = await api.listRepos();
    if (!state.currentRepoFullName && state.repos[0]) state.currentRepoFullName = state.repos[0].full_name;
    saveState();
    renderRepos();
    renderProjects();
    showAlert(`${state.repos.length} Repositories geladen.`);
  } catch (error) {
    showAlert(error.message, 'err');
  } finally {
    setLoading(button, false);
  }
}

async function scanRepo() {
  const repo = selectedRepo();
  if (!repo) return showAlert('Bitte zuerst ein Repository auswählen.', 'warn');
  const button = $('#scanRepoBtn');
  setLoading(button, true, 'Scanne...');
  try {
    const api = github();
    const [owner, name] = repo.full_name.split('/');
    const tree = await api.getRepoTree(owner, name, repo.default_branch);
    const files = pickFilesForScan(tree);
    const fileContents = {};
    for (const path of files) {
      try {
        fileContents[path] = await api.getFile(owner, name, path, repo.default_branch);
      } catch (error) {
        console.warn(`Datei konnte nicht gelesen werden: ${path}`, error);
      }
    }
    const analysis = analyzeRepository(repo, tree, fileContents, state.projects);
    const project = { fullName: repo.full_name, repo, analysis, fileContentsSample: fileContents };
    state.projects = [project, ...state.projects.filter((item) => item.fullName !== repo.full_name)];
    state.currentRepoFullName = repo.full_name;
    saveState();
    renderProjects();
    $('#memoryProjectSelect').value = repo.full_name;
    renderMemoryDetails();
    showAlert(`${repo.full_name} wurde gescannt.`);
    switchView('memory');
  } catch (error) {
    showAlert(error.message, 'err');
  } finally {
    setLoading(button, false);
  }
}

function generatePrompt() {
  const project = getProject($('#contextProjectSelect').value);
  if (!project) return showAlert('Bitte erst ein Projekt scannen.', 'warn');
  const prompt = generateContext(project, state.projects, {
    task: $('#contextTask').value,
    includeDependencies: $('#includeDependencies').checked,
    includeFileList: $('#includeFileList').checked,
    includeGuardrails: $('#includeGuardrails').checked
  });
  $('#contextOutput').value = prompt;
  showAlert('Kontext wurde erzeugt.');
}

function exportMemory() {
  downloadJson(`projektgedaechtnis-export-${new Date().toISOString().slice(0,10)}.json`, storage.exportAll());
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  document.querySelectorAll('[data-jump]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.jump)));
  $('#githubToken').value = state.token;
  $('#saveTokenBtn').addEventListener('click', () => { state.token = $('#githubToken').value.trim(); saveState(); renderStatus(); showAlert('Token gespeichert.'); });
  $('#clearTokenBtn').addEventListener('click', () => { state.token = ''; $('#githubToken').value = ''; storage.remove('githubToken'); renderStatus(); showAlert('Token gelöscht.'); });
  $('#loadReposBtn').addEventListener('click', loadRepos);
  $('#scanRepoBtn').addEventListener('click', scanRepo);
  $('#rescanCurrentBtn').addEventListener('click', scanRepo);
  $('#repoSelect').addEventListener('change', () => { state.currentRepoFullName = $('#repoSelect').value; saveState(); renderRepoMeta(); });
  $('#openRepoBtn').addEventListener('click', () => { const repo = selectedRepo(); if (repo) window.open(repo.html_url, '_blank'); });
  $('#repoTable').addEventListener('click', (event) => { const fullName = event.target.dataset.selectRepo; if (!fullName) return; state.currentRepoFullName = fullName; saveState(); renderRepos(); });
  $('#projectCards').addEventListener('click', (event) => { const fullName = event.target.dataset.openMemory; if (!fullName) return; $('#memoryProjectSelect').value = fullName; renderMemoryDetails(); switchView('memory'); });
  $('#memoryProjectSelect').addEventListener('change', renderMemoryDetails);
  $('#generateContextBtn').addEventListener('click', generatePrompt);
  $('#copyContextBtn').addEventListener('click', async () => { await copyText($('#contextOutput').value); showAlert('Kontext kopiert.'); });
  $('#deleteCurrentMemoryBtn').addEventListener('click', () => { const project = getProject($('#memoryProjectSelect').value); if (!project) return; if (!confirm(`${project.fullName} aus dem lokalen Projektgedächtnis löschen?`)) return; state.projects = state.projects.filter((item) => item.fullName !== project.fullName); saveState(); renderProjects(); showAlert('Eintrag gelöscht.'); });
  $('#exportMemoryBtn').addEventListener('click', exportMemory);
  $('#exportSettingsBtn').addEventListener('click', exportMemory);
  $('#importMemoryInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    storage.importAll(data);
    location.reload();
  });
  $('#clearAllBtn').addEventListener('click', () => { if (!confirm('Alle lokalen Daten löschen?')) return; storage.clearAll(); location.reload(); });
  $('#refreshProjectCards').addEventListener('click', renderProjects);
}

function init() {
  bindEvents();
  renderRepos();
  renderProjects();
  renderStatus();
}

init();
