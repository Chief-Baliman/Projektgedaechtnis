import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Github, Lock, RefreshCw, Upload, Copy, Database, Server, KeyRound, FileText, Undo2, Download, Search } from 'lucide-react';
import './style.css';

const api = async (path, options = {}) => {
  const res = await fetch(path, { credentials: 'include', ...options, headers: { ...(options.body && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
};

function App() {
  const [me, setMe] = useState(null);
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [repos, setRepos] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [secrets, setSecrets] = useState([]);
  const [secretForm, setSecretForm] = useState({ scope: 'global', name: '', value: '', note: '' });

  async function loadMe() { try { setMe(await api('/api/me')); } catch { setMe(null); } }
  async function loadProjects() { const d = await api('/api/projects'); setProjects(d.projects || []); }
  async function loadSecrets() { const d = await api('/api/secrets'); setSecrets(d.secrets || []); }
  useEffect(() => { loadMe(); }, []);
  useEffect(() => { if (me) { loadProjects().catch(()=>{}); loadSecrets().catch(()=>{}); } }, [me]);

  async function login(e) { e.preventDefault(); setBusy(true); try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }); await loadMe(); } catch(e){ setMessage(e.message); } finally { setBusy(false); } }
  async function saveToken() { setBusy(true); try { await api('/api/settings/github-token', { method:'POST', body: JSON.stringify({ token }) }); setToken(''); await loadMe(); setMessage('GitHub Token gespeichert.'); } catch(e){ setMessage(e.message); } finally { setBusy(false); } }
  async function loadRepos() { setBusy(true); try { const d = await api('/api/repos'); setRepos(d.repos || []); setMessage(`${(d.repos || []).length} Repositories geladen.`); } catch(e){ setMessage(e.message); } finally { setBusy(false); } }
  async function scanRepo() { const repo = repos.find(r => r.fullName === selectedRepo); if (!repo) return; setBusy(true); try { const d = await api('/api/repos/scan', { method:'POST', body: JSON.stringify({ repo }) }); setSelectedProject(d.project); await loadProjects(); setMessage(`Scan fertig. ${d.filesRead.length} Dateien gelesen.`); } catch(e){ setMessage(e.message); } finally { setBusy(false); } }
  async function createContext(project = selectedProject) { if (!project) return; setBusy(true); try { const [owner, repo] = project.fullName.split('/'); const d = await api(`/api/context/${owner}/${repo}`); setPrompt(d.prompt); setMessage('Kontext erzeugt.'); } catch(e){ setMessage(e.message); } finally { setBusy(false); } }
  async function copyPrompt() { await navigator.clipboard.writeText(prompt); setMessage('Kontext kopiert.'); }
  async function saveSecret(e) { e.preventDefault(); try { await api('/api/secrets', { method:'POST', body: JSON.stringify(secretForm) }); setSecretForm({ scope:'global', name:'', value:'', note:'' }); await loadSecrets(); setMessage('Secret gespeichert.'); } catch(e){ setMessage(e.message); } }
  async function uploadZip(e) { const file = e.target.files?.[0]; if (!file || !selectedProject) return; setBusy(true); try { const [owner, repo] = selectedProject.fullName.split('/'); const buf = await file.arrayBuffer(); const d = await fetch(`/api/deploy/${owner}/${repo}/zip`, { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/zip' }, body: buf }).then(async r => { const j = await r.json(); if(!r.ok) throw new Error(j.error); return j; }); setMessage(`Upload fertig. ${d.changed.length} Dateien übertragen.`); } catch(e){ setMessage(e.message); } finally { setBusy(false); e.target.value=''; } }
  async function rollback() { if (!selectedProject) return; if (!confirm('Letzten Upload für dieses Repository zurücksetzen?')) return; setBusy(true); try { const [owner, repo] = selectedProject.fullName.split('/'); const d = await api(`/api/deploy/${owner}/${repo}/rollback`, { method:'POST' }); setMessage(`Rollback auf ${d.sha} ausgeführt.`); } catch(e){ setMessage(e.message); } finally { setBusy(false); } }
  async function exportAll() { const d = await api('/api/export'); const blob = new Blob([JSON.stringify(d, null, 2)], { type:'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `developer-hub-export-${new Date().toISOString().slice(0,10)}.json`; a.click(); }

  const related = useMemo(() => {
    if (!selectedProject) return [];
    const ids = selectedProject.analysis?.firebase?.projectIds || [];
    return projects.filter(p => p.fullName !== selectedProject.fullName && (p.analysis?.firebase?.projectIds || []).some(x => ids.includes(x)));
  }, [projects, selectedProject]);

  if (!me) return <div className="login"><form onSubmit={login} className="card narrow"><h1>Developer Hub</h1><p>Deine Projektzentrale für ChatGPT, GitHub, Secrets und Deployments.</p><input type="password" placeholder="Admin-Passwort" value={password} onChange={e=>setPassword(e.target.value)} /><button disabled={busy}>Einloggen</button>{message && <p className="msg">{message}</p>}</form></div>;

  return <div className="app">
    <aside><h2>Developer Hub</h2><nav><a><Github/> GitHub</a><a><FileText/> Projekte</a><a><Database/> Firebase</a><a><Server/> Server & Bots</a><a><KeyRound/> Secrets</a><a><Upload/> Deploy</a></nav><button className="ghost" onClick={exportAll}><Download/> Export</button></aside>
    <main>
      <header><div><h1>Projektgedächtnis</h1><p>Scannt deine Repos, erzeugt Kontext und speichert Wissen zentral.</p></div>{busy && <span className="pill"><RefreshCw className="spin"/> läuft</span>}</header>
      {message && <div className="notice">{message}</div>}

      <section className="grid two">
        <div className="card"><h3><Lock/> GitHub Zugriff</h3><p>Status: {me.hasGithubToken ? 'Token ist zentral gespeichert.' : 'Noch kein Token gespeichert.'}</p><div className="row"><input value={token} onChange={e=>setToken(e.target.value)} placeholder="GitHub Fine-grained Token einmalig eintragen"/><button onClick={saveToken}>Speichern</button></div><button onClick={loadRepos}><RefreshCw/> Repositories laden</button></div>
        <div className="card"><h3><Search/> Repository scannen</h3><select value={selectedRepo} onChange={e=>setSelectedRepo(e.target.value)}><option value="">Repository auswählen</option>{repos.map(r=><option key={r.fullName} value={r.fullName}>{r.fullName}</option>)}</select><button onClick={scanRepo} disabled={!selectedRepo}>Scan starten</button></div>
      </section>

      <section className="grid two">
        <div className="card tall"><h3>Gespeicherte Projekte</h3><div className="projectList">{projects.map(p => <button key={p.fullName} className={selectedProject?.fullName===p.fullName?'active':''} onClick={()=>{setSelectedProject(p); setPrompt('');}}><b>{p.fullName}</b><span>{p.analysis?.purpose}</span></button>)}</div></div>
        <div className="card tall"><h3>Projektübersicht</h3>{selectedProject ? <Project project={selectedProject} related={related}/> : <p>Wähle ein Projekt aus.</p>}</div>
      </section>

      {selectedProject && <section className="grid two">
        <div className="card"><h3>ChatGPT-Kontext</h3><button onClick={()=>createContext()}><FileText/> Kontext erzeugen</button>{prompt && <><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} /><button onClick={copyPrompt}><Copy/> Kopieren</button></>}</div>
        <div className="card"><h3>ZIP Deploy</h3><p>Überschreibt Dateien aus der ZIP. Nicht enthaltene Dateien bleiben bestehen.</p><input type="file" accept=".zip,application/zip" onChange={uploadZip}/><button className="danger" onClick={rollback}><Undo2/> Letzten Upload zurücksetzen</button></div>
      </section>}

      <section className="grid two">
        <div className="card"><h3>Secrets speichern</h3><form onSubmit={saveSecret} className="stack"><input placeholder="Scope, z. B. global oder Chief-Baliman/quizt-scoreboard" value={secretForm.scope} onChange={e=>setSecretForm({...secretForm, scope:e.target.value})}/><input placeholder="Name, z. B. VPS IP oder Telegram Bot Token" value={secretForm.name} onChange={e=>setSecretForm({...secretForm, name:e.target.value})}/><input type="password" placeholder="Wert" value={secretForm.value} onChange={e=>setSecretForm({...secretForm, value:e.target.value})}/><input placeholder="Notiz ohne geheime Werte" value={secretForm.note} onChange={e=>setSecretForm({...secretForm, note:e.target.value})}/><button>Secret verschlüsselt speichern</button></form></div>
        <div className="card"><h3>Hinterlegte Secrets</h3>{secrets.map(s=><div className="secret" key={s.id}><b>{s.name}</b><span>{s.scope}</span><small>{s.note}</small></div>)}</div>
      </section>
    </main>
  </div>;
}

function Project({ project, related }) {
  const a = project.analysis || {};
  return <div className="summary"><h2>{project.fullName}</h2><p>{a.purpose}</p><div className="badges">{(a.tech||[]).map(t=><span key={t}>{t}</span>)}</div><dl><dt>Pages</dt><dd>{a.pagesUrl || 'nicht erkannt'}</dd><dt>Firebase</dt><dd>{a.firebase?.projectIds?.join(', ') || 'nicht erkannt'}</dd><dt>Datenpfade</dt><dd>{a.firebase?.paths?.join(', ') || 'keine erkannt'}</dd><dt>Wichtige Dateien</dt><dd>{(a.importantFiles||[]).slice(0,8).join(', ')}</dd></dl><h4>Gesundheit</h4><div className="health">{(a.health||[]).map(h=><span className={h.status} key={h.label}>{h.label}</span>)}</div><h4>Abhängigkeiten</h4>{related.length ? related.map(r=><p key={r.fullName}>{r.fullName}</p>) : <p>Keine gemeinsamen Ressourcen erkannt.</p>}<h4>Wiki</h4><pre>{a.wiki}</pre></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
