const TEXT_EXT = /\.(html|js|ts|tsx|jsx|json|md|css|yml|yaml|env|txt|rules|cjs|mjs)$/i;
const MAX_FILES = 80;
const MAX_FILE_SIZE = 180000;

function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }
function findAll(regex, text) { return [...text.matchAll(regex)].map(m => m[1] || m[0]); }

export function analyzeRepository(repo, files) {
  const contentJoined = files.map(f => `\n--- ${f.path} ---\n${f.content}`).join('\n');
  const paths = files.map(f => f.path);
  const lower = contentJoined.toLowerCase();
  const tech = [];
  if (paths.some(p => p.endsWith('.html')) || lower.includes('<!doctype html')) tech.push('HTML');
  if (paths.some(p => p.endsWith('.js')) || lower.includes('javascript')) tech.push('JavaScript');
  if (paths.some(p => p.endsWith('.ts') || p.endsWith('.tsx'))) tech.push('TypeScript');
  if (paths.includes('package.json')) tech.push('Node.js');
  if (lower.includes('firebase')) tech.push('Firebase');
  if (lower.includes('telegram') || lower.includes('botfather')) tech.push('Telegram Bot');
  if (lower.includes('pm2')) tech.push('PM2');
  if (paths.some(p => p.includes('.github/workflows'))) tech.push('GitHub Actions');

  const projectIds = uniq(findAll(/projectId\s*[:=]\s*["'`]([^"'`]+)["'`]/g, contentJoined));
  const dbUrls = uniq(findAll(/databaseURL\s*[:=]\s*["'`]([^"'`]+)["'`]/g, contentJoined));
  const firebasePaths = uniq([
    ...findAll(/ref\(\s*db\s*,\s*["'`]([^"'`]+)["'`]\s*\)/g, contentJoined),
    ...findAll(/child\([^,]*,\s*["'`]([^"'`]+)["'`]\)/g, contentJoined)
  ]);

  const bots = [];
  if (lower.includes('telegram')) bots.push('Telegram im Code erwähnt');
  if (/bot(token|_token)|TELEGRAM_BOT_TOKEN/i.test(contentJoined)) bots.push('Bot-Token-Variable erkannt');
  if (/webhook/i.test(contentJoined)) bots.push('Webhook-Struktur erkannt');

  const importantFiles = paths.filter(p => /^(index\.html|package\.json|firebase\.json|database\.rules\.json|README\.md|\.github\/workflows|server\.js|app\.js|main\.js|src\/)/i.test(p)).slice(0, 25);
  const todos = uniq(findAll(/\b(TODO|FIXME|HACK)\b[:\s-]*(.{0,100})/gi, contentJoined).map(x => String(x).trim())).slice(0, 20);

  const realSecretWarnings = [];
  for (const f of files) {
    const c = f.content;
    if (/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(c)) realSecretWarnings.push(`${f.path}: Private Key`);
    if (/ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+/.test(c)) realSecretWarnings.push(`${f.path}: GitHub Token`);
    if (/TELEGRAM_BOT_TOKEN\s*=\s*\d+:[A-Za-z0-9_-]+/.test(c)) realSecretWarnings.push(`${f.path}: Telegram Token`);
  }

  let purpose = 'Zweck nicht eindeutig erkannt. Bitte aus README oder Code ergänzen.';
  if (/queue|warteschlange|bestellnummer|overlay/i.test(contentJoined)) purpose = 'Livestream-Overlay und Verwaltungsoberfläche für eine Bestellwarteschlange.';
  if (/quizt|scoreboard|liga|moderator/i.test(contentJoined)) purpose = 'Quizt-Anwendung für Punkte, Events, Moderation oder Liga.';
  if (/flohmarkt|bestand|preis|barcode|produkt/i.test(contentJoined)) purpose = 'ChiefCards Flohmarkt-Manager für Produkte, Preise, Bestände und mobile Nutzung.';
  if (/deal|otakuya|dashboard/i.test(contentJoined)) purpose = 'Dashboard zur Auswertung oder Verwaltung von Deals.';
  if (/bulk/i.test(repo.name)) purpose = 'Tool zur Analyse oder Verarbeitung von Bulk-Karten.';

  const architecture = [];
  if (files.length === 1 && paths.includes('index.html')) architecture.push('Ein-Datei-App: index.html enthält Oberfläche, Logik und Styles.');
  if (lower.includes('firebasejs') && lower.includes('gstatic.com')) architecture.push('Firebase wird clientseitig per CDN eingebunden.');
  if (lower.includes('getdatabase') || lower.includes('realtime')) architecture.push('Nutzt Firebase Realtime Database.');
  if (lower.includes('urlsearchparams')) architecture.push('URL-Parameter steuern Teile der Oberfläche oder Modi.');
  if (paths.includes('package.json')) architecture.push('Node/Vite/Build-Struktur vorhanden.');
  if (repo.hasPages) architecture.push('GitHub Pages ist laut Repository aktiv.');

  const health = [
    { label: 'README vorhanden', status: paths.some(p => /^README\.md$/i.test(p)) ? 'ok' : 'warn' },
    { label: 'GitHub Pages', status: repo.hasPages ? 'ok' : 'warn' },
    { label: 'Firebase erkannt', status: projectIds.length || dbUrls.length || lower.includes('firebase') ? 'ok' : 'neutral' },
    { label: 'Kritische Secrets im Code', status: realSecretWarnings.length ? 'danger' : 'ok' },
    { label: 'TODOs gefunden', status: todos.length ? 'warn' : 'ok' }
  ];

  const wiki = buildWiki({ repo, purpose, tech: uniq(tech), projectIds, dbUrls, firebasePaths, bots, importantFiles, architecture, health, realSecretWarnings });

  return {
    repoName: repo.name,
    fullName: repo.fullName,
    purpose,
    defaultBranch: repo.defaultBranch,
    htmlUrl: repo.htmlUrl,
    pagesUrl: repo.hasPages ? `https://${repo.fullName.split('/')[0]}.github.io/${repo.name}/` : '',
    updatedAt: repo.updatedAt,
    fileCount: paths.length,
    scannedFiles: files.length,
    tech: uniq(tech),
    firebase: { detected: Boolean(projectIds.length || dbUrls.length || lower.includes('firebase')), projectIds, dbUrls, paths: firebasePaths },
    bots,
    hosting: repo.hasPages ? ['GitHub Pages aktiv'] : [],
    importantFiles,
    architecture,
    secretWarnings: realSecretWarnings,
    todos,
    health,
    wiki,
    scannedAt: new Date().toISOString(),
    guardrails: [
      'Bestehende Funktionen erhalten und Änderungen nicht blind auf andere Projekte übertragen.',
      'Firebase Rules und Datenbankstruktur nie ohne Gesamtstand vollständig ersetzen. Änderungen immer ergänzend integrieren.',
      'Secrets, Tokens, Private Keys und Passwörter nicht in ZIPs oder Chat-Ausgaben übernehmen.',
      'Bei GitHub-Pages-Projekten relative Pfade und statisches Hosting beachten.',
      'ZIP-Deploy überschreibt nur vorhandene Pfade aus der ZIP. Nicht enthaltene Repo-Dateien bleiben bestehen.'
    ]
  };
}

function buildWiki(x) {
  return `# ${x.repo.fullName}\n\n## Zweck\n\n${x.purpose}\n\n## Technik\n\n${x.tech.length ? x.tech.map(t => `- ${t}`).join('\n') : '- Nicht eindeutig erkannt'}\n\n## Hosting\n\n${x.repo.hasPages ? `- GitHub Pages: https://${x.repo.fullName.split('/')[0]}.github.io/${x.repo.name}/` : '- Kein GitHub Pages erkannt'}\n\n## Firebase\n\n${x.projectIds.length ? x.projectIds.map(p => `- Projekt-ID: ${p}`).join('\n') : '- Keine Projekt-ID erkannt'}\n${x.dbUrls.length ? x.dbUrls.map(u => `- Database URL: ${u}`).join('\n') : ''}\n${x.firebasePaths.length ? x.firebasePaths.map(p => `- Datenpfad: ${p}`).join('\n') : ''}\n\n## Architektur\n\n${x.architecture.length ? x.architecture.map(a => `- ${a}`).join('\n') : '- Keine sichere Architektur-Zusammenfassung möglich'}\n\n## Wichtige Dateien\n\n${x.importantFiles.length ? x.importantFiles.map(f => `- ${f}`).join('\n') : '- Keine wichtigen Dateien erkannt'}\n\n## Risiken\n\n${x.realSecretWarnings.length ? x.realSecretWarnings.map(s => `- ${s}`).join('\n') : '- Keine kritischen Secrets erkannt'}\n\n## Änderungsregeln\n\n- Bestehende Funktionen erhalten.\n- Firebase-Strukturen nicht blind ersetzen.\n- Secrets niemals in ChatGPT-Prompts oder ZIP-Dateien übernehmen.\n`;}

export function shouldReadFile(item) {
  return item.type === 'blob' && TEXT_EXT.test(item.path) && (item.size || 0) <= MAX_FILE_SIZE;
}

export function limitReadable(tree) {
  const preferred = tree.filter(shouldReadFile).sort((a,b) => {
    const score = p => /README|index\.html|package\.json|firebase|src\//i.test(p.path) ? 0 : 1;
    return score(a) - score(b);
  });
  return preferred.slice(0, MAX_FILES);
}
