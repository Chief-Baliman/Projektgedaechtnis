const TEXT_EXT = /\.(html|js|ts|tsx|jsx|json|md|css|yml|yaml|env|txt|rules|cjs|mjs|py|service|toml|ini|conf)$/i;
const MAX_FILES = 140;
const MAX_FILE_SIZE = 260000;
const uniq = arr => [...new Set(arr.filter(Boolean))];
const findAll = (re, txt) => [...txt.matchAll(re)].map(m => m[1] || m[0]);

export function shouldReadFile(item) {
  return item.type === 'blob' && TEXT_EXT.test(item.path) && (item.size || 0) <= MAX_FILE_SIZE && !/node_modules|dist|build|vendor|\.min\.js|package-lock\.json/i.test(item.path);
}

export function limitReadable(tree) {
  return tree.filter(shouldReadFile).sort((a,b) => score(a.path) - score(b.path)).slice(0, MAX_FILES);
}
function score(p) { return /README|index\.html|package\.json|firebase|database|rules|src\/|server|app|main|\.env\.example|\.github\/workflows|vite|config|requirements|\.service/i.test(p) ? 0 : 1; }

export function analyzeRepository(repo, files, allKnownProjects = []) {
  const paths = files.map(f => f.path);
  const joined = files.map(f => `\n--- ${f.path} ---\n${f.content}`).join('\n');
  const lower = joined.toLowerCase();
  const tech = inferTech(paths, lower);
  const firebase = inferFirebase(joined, lower);
  const bots = inferBots(joined);
  const projectSpace = inferProjectSpace(repo, joined);
  const purpose = inferPurpose(repo, joined, projectSpace);
  const architecture = inferArchitecture(paths, joined, repo);
  const dataModel = inferDataModel(joined);
  const routes = inferRoutes(joined);
  const importantFiles = paths.filter(p => /^(index\.html|package\.json|firebase\.json|database\.rules\.json|README\.md|\.env\.example|\.github\/workflows|server|src\/|app\.py|main\.py|requirements\.txt|vite\.config|tailwind|nginx|docker|Dockerfile)/i.test(p)).slice(0, 60);
  const todos = uniq(findAll(/\b(?:TODO|FIXME|HACK)\b[:\s-]*(.{0,140})/gi, joined).map(x => String(x).trim())).slice(0, 40);
  const secrets = detectSecrets(files);
  const sharedFirebase = allKnownProjects.filter(p => p.fullName !== repo.fullName && (p.analysis?.firebase?.projectIds || []).some(id => firebase.projectIds.includes(id))).map(p => ({ fullName:p.fullName, space:p.analysis?.projectSpace?.name || 'Unbekannt' }));
  const related = inferRelated(repo, projectSpace, firebase, allKnownProjects);
  const ownershipNotes = inferOwnershipNotes(projectSpace);
  const health = [
    { label: 'README vorhanden', status: paths.some(p => /^README\.md$/i.test(p)) ? 'ok' : 'warn' },
    { label: 'GitHub Pages', status: repo.hasPages ? 'ok' : 'neutral' },
    { label: 'Firebase erkannt', status: firebase.detected ? 'ok' : 'neutral' },
    { label: 'Kritische Secrets im Code', status: secrets.length ? 'danger' : 'ok' },
    { label: 'TODOs gefunden', status: todos.length ? 'warn' : 'ok' },
    { label: 'Projektgruppe', status: projectSpace.key === 'unknown' ? 'warn' : 'ok' }
  ];
  const wiki = buildWiki({ repo, purpose, tech, firebase, bots, projectSpace, ownershipNotes, importantFiles, architecture, secrets, sharedFirebase, dataModel, routes, todos });
  return {
    repoName: repo.name, fullName: repo.fullName, purpose, defaultBranch: repo.defaultBranch, htmlUrl: repo.htmlUrl,
    pagesUrl: repo.hasPages ? `https://${repo.fullName.split('/')[0]}.github.io/${repo.name}/` : '', updatedAt: repo.updatedAt,
    fileCount: paths.length, scannedFiles: files.length, tech, projectSpace, ownershipNotes,
    firebase: { ...firebase, sharedWith: sharedFirebase },
    bots, routes, dataModel, relatedProjects: related,
    hosting: repo.hasPages ? ['GitHub Pages aktiv'] : [], importantFiles, architecture, secretWarnings: secrets, todos, health, wiki,
    scannedAt: new Date().toISOString(), guardrails: buildGuardrails(projectSpace, firebase, repo)
  };
}

function inferTech(paths, lower) {
  const tech = [];
  if (paths.some(p => p.endsWith('.html')) || lower.includes('<!doctype html')) tech.push('HTML');
  if (paths.some(p => /\.(js|mjs|cjs)$/.test(p))) tech.push('JavaScript');
  if (paths.some(p => /\.(ts|tsx)$/.test(p))) tech.push('TypeScript');
  if (paths.includes('package.json')) tech.push('Node.js');
  if (lower.includes('vite')) tech.push('Vite');
  if (lower.includes('react')) tech.push('React');
  if (lower.includes('express')) tech.push('Express');
  if (lower.includes('firebase')) tech.push('Firebase');
  if (lower.includes('telegram')) tech.push('Telegram Bot');
  if (paths.some(p => p.endsWith('.py')) || lower.includes('python')) tech.push('Python');
  if (lower.includes('gunicorn')) tech.push('Gunicorn');
  if (lower.includes('playwright')) tech.push('Playwright');
  if (paths.some(p => p.includes('.github/workflows'))) tech.push('GitHub Actions');
  return uniq(tech);
}

function inferFirebase(joined, lower) {
  const projectIds = uniq(findAll(/projectId\s*[:=]\s*["'`]([^"'`]+)["'`]/g, joined));
  const dbUrls = uniq(findAll(/databaseURL\s*[:=]\s*["'`]([^"'`]+)["'`]/g, joined));
  const paths = uniq([
    ...findAll(/ref\(\s*db\s*,\s*["'`]([^"'`]+)["'`]\s*\)/g, joined),
    ...findAll(/ref\(\s*database\s*,\s*["'`]([^"'`]+)["'`]\s*\)/g, joined),
    ...findAll(/child\([^,]*,\s*["'`]([^"'`]+)["'`]\)/g, joined),
    ...findAll(/(?:set|update|push|onValue|get|remove)\(\s*ref\([^,]+,\s*["'`]([^"'`]+)["'`]/g, joined)
  ]).filter(p => !/^https?:/.test(p));
  const rulesMentioned = /database\.rules|\.read|\.write|firebase rules|rules_version/i.test(joined);
  return { detected: Boolean(projectIds.length || dbUrls.length || lower.includes('firebase')), projectIds, dbUrls, paths, rulesMentioned };
}

function inferBots(joined) {
  const botSignals = [];
  if (/telegram/i.test(joined)) botSignals.push('Telegram im Code erwähnt');
  if (/webhook/i.test(joined)) botSignals.push('Webhook-Struktur erkannt');
  if (/systemd|\.service|gunicorn|pm2/i.test(joined)) botSignals.push('Server-Dienst-Struktur erkannt');
  if (/playwright|chromium|watcher|scraper/i.test(joined)) botSignals.push('Watcher/Scraper-Struktur erkannt');
  return botSignals;
}

function inferProjectSpace(repo, txt) {
  const name = `${repo.fullName} ${repo.name}`.toLowerCase();
  const lower = txt.toLowerCase();
  if (/quizt|quiz_mit_twist|streetlife|liga|scoreboard|quizabend/.test(name + ' ' + lower)) {
    return { key:'quizt', name:'Quizt / Laura', type:'externes Projekt', owner:'Laura / Quizt', separation:'Nicht mit ChiefCards vermischen. Fabian entwickelt Technik, aber Quizt ist inhaltlich und organisatorisch ein eigenes Projekt.' };
  }
  if (/chiefcards|chief-bali|queue|stream|offer|roadtoglo|pullcounter|flohmarkt|bulk|cardmarket|otakuya|jp-display|ofcs/.test(name + ' ' + lower)) {
    return { key:'chiefcards', name:'ChiefCards / Fabian', type:'eigenes Business', owner:'Fabian / ChiefCards', separation:'Gehört zu ChiefCards, Stream, Shop, Kartenhandel oder internen Tools.' };
  }
  if (/telegram|bot|watcher|vps|server|gunicorn|systemd/.test(name + ' ' + lower)) {
    return { key:'server', name:'Server / Bots', type:'Infrastruktur', owner:'Fabian', separation:'Servernahe Dienste getrennt von einzelnen Markenprojekten dokumentieren.' };
  }
  return { key:'unknown', name:'Unsortiert', type:'noch einordnen', owner:'unbekannt', separation:'Projektgruppe manuell prüfen.' };
}

function inferOwnershipNotes(space) {
  if (space.key === 'quizt') return [
    'Quizt ist ein externes Projekt für Laura und gehört nicht zu ChiefCards.',
    'Branding, Sprache, Socials und Geschäftslogik nicht mit ChiefCards, ChiefBaliman oder Kartenhandel vermischen.',
    'Technische Infrastruktur darf gemeinsam genutzt werden, muss im Kontext aber klar als externe Abhängigkeit markiert werden.'
  ];
  if (space.key === 'chiefcards') return [
    'Gehört zum ChiefCards/ChiefBaliman-Umfeld.',
    'Kann mit Stream-, Shop-, Karten- und Flohmarkt-Tools zusammen betrachtet werden.'
  ];
  return ['Projektgruppe noch nicht sicher erkannt. Vor größeren Änderungen manuell einordnen.'];
}

function inferPurpose(repo, txt, space) {
  if (space.key === 'quizt') {
    if (/scoreboard|punkte|moderator|liga/i.test(txt + repo.name)) return 'Quizt-Anwendung für Punkteübersicht, Moderation, Events und Liga. Externes Projekt für Laura, nicht ChiefCards.';
    return 'Quizt-Website oder Quizt-Tool. Externes Projekt für Laura, getrennt von ChiefCards.';
  }
  if (/queue|warteschlange|bestellnummer|overlay/i.test(txt)) return 'Livestream-Overlay und Verwaltungsoberfläche für eine Bestellwarteschlange.';
  if (/flohmarkt|bestand|preis|barcode|produkt/i.test(txt)) return 'ChiefCards Flohmarkt-Manager für Produkte, Preise, Bestände und mobile Nutzung.';
  if (/watchlist|watcher|product watcher|playwright/i.test(txt)) return 'Serverseitiger Watcher oder Dashboard zur Produktbeobachtung.';
  if (/telegram|bot/i.test(txt)) return 'Bot-Anwendung mit Telegram oder Webhook-Anbindung.';
  if (/bulk/i.test(repo.name)) return 'Tool zur Analyse oder Verarbeitung von Bulk-Karten.';
  return repo.description || 'Zweck nicht eindeutig erkannt. Bitte einmal manuell ergänzen.';
}

function inferArchitecture(paths, txt, repo) {
  const lower = txt.toLowerCase();
  const a = [];
  if (paths.length === 1 && paths.includes('index.html')) a.push('Ein-Datei-App: index.html enthält Oberfläche, Logik und Styles.');
  if (lower.includes('firebasejs') && lower.includes('gstatic.com')) a.push('Firebase wird clientseitig per CDN eingebunden.');
  if (lower.includes('getdatabase') || lower.includes('realtime')) a.push('Nutzt Firebase Realtime Database.');
  if (lower.includes('urlsearchparams')) a.push('URL-Parameter steuern Modi oder Ansichten.');
  if (paths.includes('package.json')) a.push('Node/JavaScript-Projekt mit package.json.');
  if (paths.some(p => p.startsWith('server/'))) a.push('Backend-Struktur vorhanden.');
  if (paths.some(p => p.startsWith('src/'))) a.push('Quellcode liegt im src-Verzeichnis.');
  if (repo.hasPages) a.push('GitHub Pages ist laut Repository aktiv.');
  return a;
}

function inferDataModel(txt) {
  const keys = uniq([
    ...findAll(/(?:const|let|var)\s+([A-Za-z0-9_]*(?:State|Data|Config|Event|Team|Queue|Product|League)[A-Za-z0-9_]*)\s*=/g, txt),
    ...findAll(/localStorage\.setItem\(["'`]([^"'`]+)["'`]/g, txt),
    ...findAll(/sessionStorage\.setItem\(["'`]([^"'`]+)["'`]/g, txt)
  ]).slice(0, 30);
  return keys;
}

function inferRoutes(txt) {
  return uniq([
    ...findAll(/app\.(?:get|post|put|delete|patch)\(["'`]([^"'`]+)["'`]/g, txt),
    ...findAll(/fetch\(["'`]([^"'`]+)["'`]/g, txt)
  ]).slice(0, 40);
}

function inferRelated(repo, space, firebase, allKnownProjects) {
  return allKnownProjects.filter(p => p.fullName !== repo.fullName).map(p => {
    const sameFirebase = (p.analysis?.firebase?.projectIds || []).some(id => firebase.projectIds.includes(id));
    const sameSpace = p.analysis?.projectSpace?.key && p.analysis.projectSpace.key === space.key;
    if (!sameFirebase && !sameSpace) return null;
    return { fullName:p.fullName, reason:sameFirebase ? 'teilt Firebase-Ressource' : 'gleiche Projektgruppe', space:p.analysis?.projectSpace?.name || 'Unbekannt', hardDependency:sameFirebase };
  }).filter(Boolean);
}

function detectSecrets(files) {
  const secrets = [];
  for (const f of files) {
    if (/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(f.content)) secrets.push(`${f.path}: Private Key`);
    if (/ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+/.test(f.content)) secrets.push(`${f.path}: GitHub Token`);
    if (/\d{6,12}:[A-Za-z0-9_-]{25,}/.test(f.content)) secrets.push(`${f.path}: möglicher Telegram Bot Token`);
    if (/password\s*=\s*["'][^"']{8,}["']/i.test(f.content)) secrets.push(`${f.path}: mögliches Passwort`);
  }
  return secrets;
}

function buildGuardrails(space, firebase, repo) {
  const base = [
    'Bestehende Funktionen erhalten und Änderungen gezielt einbauen.',
    'Secrets, Tokens, Private Keys und Passwörter nicht in ZIPs, Code oder Chat-Ausgaben übernehmen.',
    'ZIP-Deploy überschreibt nur Pfade aus der ZIP. Nicht enthaltene Repo-Dateien bleiben bestehen.'
  ];
  if (firebase.detected) base.push('Firebase Rules und Datenbankstruktur nie ohne Gesamtstand vollständig ersetzen. Änderungen immer integrieren.');
  if (repo.hasPages) base.push('Bei GitHub-Pages-Projekten relative Pfade und statisches Hosting beachten.');
  if (space.key === 'quizt') base.unshift('Quizt ist extern für Laura. Nicht mit ChiefCards, ChiefBaliman, Shop, Kartenhandel oder Stream-Branding vermischen.');
  return base;
}

function buildWiki(x) {
  return `# ${x.repo.fullName}\n\n## Projektgruppe\n- Bereich: ${x.projectSpace.name}\n- Typ: ${x.projectSpace.type}\n- Verantwortlich: ${x.projectSpace.owner}\n- Trennung: ${x.projectSpace.separation}\n\n## Zweck\n${x.purpose}\n\n## Besitz- und Kontextregeln\n${x.ownershipNotes.map(n => `- ${n}`).join('\n')}\n\n## Technik\n${x.tech.length ? x.tech.map(t => `- ${t}`).join('\n') : '- Nicht eindeutig erkannt'}\n\n## Hosting\n${x.repo.hasPages ? `- GitHub Pages: https://${x.repo.fullName.split('/')[0]}.github.io/${x.repo.name}/` : '- Kein GitHub Pages erkannt'}\n\n## Firebase\n${x.firebase.projectIds.length ? x.firebase.projectIds.map(p => `- Projekt-ID: ${p}`).join('\n') : '- Keine Projekt-ID erkannt'}\n${x.firebase.dbUrls.length ? x.firebase.dbUrls.map(u => `- Database URL: ${u}`).join('\n') : ''}\n${x.firebase.paths.length ? x.firebase.paths.map(p => `- Datenpfad: ${p}`).join('\n') : ''}\n${x.sharedFirebase.length ? `\nGeteilte Firebase-Ressourcen:\n${x.sharedFirebase.map(p => `- ${p.fullName} (${p.space})`).join('\n')}` : ''}\n\n## Architektur\n${x.architecture.length ? x.architecture.map(a => `- ${a}`).join('\n') : '- Keine sichere Architektur-Zusammenfassung möglich'}\n\n## Erkannte Datenmodelle / Schlüssel\n${x.dataModel.length ? x.dataModel.map(k => `- ${k}`).join('\n') : '- Keine klaren Datenmodelle erkannt'}\n\n## Erkannte Routen / API-Pfade\n${x.routes.length ? x.routes.map(r => `- ${r}`).join('\n') : '- Keine Routen erkannt'}\n\n## Wichtige Dateien\n${x.importantFiles.length ? x.importantFiles.map(f => `- ${f}`).join('\n') : '- Keine wichtigen Dateien erkannt'}\n\n## Risiken\n${x.secrets.length ? x.secrets.map(s => `- ${s}`).join('\n') : '- Keine kritischen Secrets erkannt'}\n${x.todos.length ? `\n## TODOs\n${x.todos.map(t => `- ${t}`).join('\n')}` : ''}\n\n## Änderungsregeln\n- Bestehende Funktionen erhalten.\n- Projektgruppe beachten und fremde Marken-/Business-Kontexte nicht vermischen.\n- Firebase-Strukturen nicht blind ersetzen.\n- Secrets niemals in ChatGPT-Prompts oder ZIP-Dateien übernehmen.\n`;}
