const TEXT_EXT = /\.(html|js|ts|tsx|jsx|json|md|css|yml|yaml|env|txt|rules|cjs|mjs|py|service|toml|ini)$/i;
const MAX_FILES = 100;
const MAX_FILE_SIZE = 220000;
const uniq = arr => [...new Set(arr.filter(Boolean))];
const findAll = (re, txt) => [...txt.matchAll(re)].map(m => m[1] || m[0]);

export function shouldReadFile(item) {
  return item.type === 'blob' && TEXT_EXT.test(item.path) && (item.size || 0) <= MAX_FILE_SIZE && !/node_modules|dist|build|vendor|\.min\.js/i.test(item.path);
}

export function limitReadable(tree) {
  return tree.filter(shouldReadFile).sort((a,b) => score(a.path) - score(b.path)).slice(0, MAX_FILES);
}
function score(p) { return /README|index\.html|package\.json|firebase|database|rules|src\/|server|app|main|\.env\.example|\.github\/workflows/i.test(p) ? 0 : 1; }

export function analyzeRepository(repo, files, allKnownProjects = []) {
  const paths = files.map(f => f.path);
  const joined = files.map(f => `\n--- ${f.path} ---\n${f.content}`).join('\n');
  const lower = joined.toLowerCase();
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
  if (paths.some(p => p.includes('.github/workflows'))) tech.push('GitHub Actions');

  const projectIds = uniq(findAll(/projectId\s*[:=]\s*["'`]([^"'`]+)["'`]/g, joined));
  const dbUrls = uniq(findAll(/databaseURL\s*[:=]\s*["'`]([^"'`]+)["'`]/g, joined));
  const firebasePaths = uniq([
    ...findAll(/ref\(\s*db\s*,\s*["'`]([^"'`]+)["'`]\s*\)/g, joined),
    ...findAll(/ref\(\s*database\s*,\s*["'`]([^"'`]+)["'`]\s*\)/g, joined),
    ...findAll(/child\([^,]*,\s*["'`]([^"'`]+)["'`]\)/g, joined)
  ]);

  const botSignals = [];
  if (/telegram/i.test(joined)) botSignals.push('Telegram im Code erwähnt');
  if (/webhook/i.test(joined)) botSignals.push('Webhook-Struktur erkannt');
  if (/systemd|\.service|gunicorn|pm2/i.test(joined)) botSignals.push('Server-Dienst-Struktur erkannt');

  const importantFiles = paths.filter(p => /^(index\.html|package\.json|firebase\.json|database\.rules\.json|README\.md|\.env\.example|\.github\/workflows|server|src\/|app\.py|main\.py|requirements\.txt)/i.test(p)).slice(0, 40);
  const todos = uniq(findAll(/\b(?:TODO|FIXME|HACK)\b[:\s-]*(.{0,120})/gi, joined).map(x => String(x).trim())).slice(0, 30);
  const secrets = [];
  for (const f of files) {
    if (/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(f.content)) secrets.push(`${f.path}: Private Key`);
    if (/ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+/.test(f.content)) secrets.push(`${f.path}: GitHub Token`);
    if (/\d{6,12}:[A-Za-z0-9_-]{25,}/.test(f.content)) secrets.push(`${f.path}: möglicher Telegram Bot Token`);
    if (/password\s*=\s*["'][^"']{8,}["']/i.test(f.content)) secrets.push(`${f.path}: mögliches Passwort`);
  }

  const purpose = inferPurpose(repo, joined);
  const architecture = inferArchitecture(paths, joined, repo);
  const sharedFirebase = allKnownProjects.filter(p => p.fullName !== repo.fullName && (p.analysis?.firebase?.projectIds || []).some(id => projectIds.includes(id))).map(p => p.fullName);
  const health = [
    { label: 'README vorhanden', status: paths.some(p => /^README\.md$/i.test(p)) ? 'ok' : 'warn' },
    { label: 'GitHub Pages', status: repo.hasPages ? 'ok' : 'neutral' },
    { label: 'Firebase erkannt', status: projectIds.length || dbUrls.length || lower.includes('firebase') ? 'ok' : 'neutral' },
    { label: 'Kritische Secrets im Code', status: secrets.length ? 'danger' : 'ok' },
    { label: 'TODOs gefunden', status: todos.length ? 'warn' : 'ok' }
  ];
  const wiki = buildWiki({ repo, purpose, tech: uniq(tech), projectIds, dbUrls, firebasePaths, botSignals, importantFiles, architecture, secrets, sharedFirebase });

  return {
    repoName: repo.name, fullName: repo.fullName, purpose, defaultBranch: repo.defaultBranch, htmlUrl: repo.htmlUrl,
    pagesUrl: repo.hasPages ? `https://${repo.fullName.split('/')[0]}.github.io/${repo.name}/` : '', updatedAt: repo.updatedAt,
    fileCount: paths.length, scannedFiles: files.length, tech: uniq(tech), firebase: { detected: Boolean(projectIds.length || dbUrls.length || lower.includes('firebase')), projectIds, dbUrls, paths: firebasePaths, sharedWith: sharedFirebase },
    bots: botSignals, hosting: repo.hasPages ? ['GitHub Pages aktiv'] : [], importantFiles, architecture, secretWarnings: secrets, todos, health, wiki,
    scannedAt: new Date().toISOString(), guardrails: [
      'Bestehende Funktionen erhalten und Änderungen gezielt einbauen.',
      'Firebase Rules und Datenbankstruktur nie ohne Gesamtstand vollständig ersetzen. Änderungen immer integrieren.',
      'Secrets, Tokens, Private Keys und Passwörter nicht in ZIPs, Code oder Chat-Ausgaben übernehmen.',
      'Bei GitHub-Pages-Projekten relative Pfade und statisches Hosting beachten.',
      'ZIP-Deploy überschreibt nur Pfade aus der ZIP. Nicht enthaltene Repo-Dateien bleiben bestehen.'
    ]
  };
}

function inferPurpose(repo, txt) {
  if (/queue|warteschlange|bestellnummer|overlay/i.test(txt)) return 'Livestream-Overlay und Verwaltungsoberfläche für eine Bestellwarteschlange.';
  if (/quizt|scoreboard|liga|moderator/i.test(txt)) return 'Quizt-Anwendung für Events, Punkte, Moderation, Liga oder Website.';
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
function buildWiki(x) {
  return `# ${x.repo.fullName}\n\n## Zweck\n${x.purpose}\n\n## Technik\n${x.tech.length ? x.tech.map(t => `- ${t}`).join('\n') : '- Nicht eindeutig erkannt'}\n\n## Hosting\n${x.repo.hasPages ? `- GitHub Pages: https://${x.repo.fullName.split('/')[0]}.github.io/${x.repo.name}/` : '- Kein GitHub Pages erkannt'}\n\n## Firebase\n${x.projectIds.length ? x.projectIds.map(p => `- Projekt-ID: ${p}`).join('\n') : '- Keine Projekt-ID erkannt'}\n${x.dbUrls.length ? x.dbUrls.map(u => `- Database URL: ${u}`).join('\n') : ''}\n${x.firebasePaths.length ? x.firebasePaths.map(p => `- Datenpfad: ${p}`).join('\n') : ''}\n${x.sharedFirebase.length ? `\nGeteilte Firebase-Ressourcen:\n${x.sharedFirebase.map(p => `- ${p}`).join('\n')}` : ''}\n\n## Architektur\n${x.architecture.length ? x.architecture.map(a => `- ${a}`).join('\n') : '- Keine sichere Architektur-Zusammenfassung möglich'}\n\n## Wichtige Dateien\n${x.importantFiles.length ? x.importantFiles.map(f => `- ${f}`).join('\n') : '- Keine wichtigen Dateien erkannt'}\n\n## Risiken\n${x.secrets.length ? x.secrets.map(s => `- ${s}`).join('\n') : '- Keine kritischen Secrets erkannt'}\n\n## Änderungsregeln\n- Bestehende Funktionen erhalten.\n- Firebase-Strukturen nicht blind ersetzen.\n- Secrets niemals in ChatGPT-Prompts oder ZIP-Dateien übernehmen.\n`;}
