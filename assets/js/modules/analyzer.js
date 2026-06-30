const IMPORTANT_FILES = [
  'README.md', 'package.json', 'firebase.json', 'database.rules.json', 'firestore.rules',
  '.firebaserc', 'index.html', 'app.js', 'main.js', 'src/main.js', 'src/App.jsx',
  'vite.config.js', 'next.config.js', '.github/workflows', 'Dockerfile', 'docker-compose.yml',
  '.env.example', 'server.js', 'bot.js', 'pm2.config.js', 'ecosystem.config.js'
];

const SECRET_PATTERNS = [/token\s*[:=]/i, /api[_-]?key\s*[:=]/i, /private[_-]?key/i, /password\s*[:=]/i, /secret\s*[:=]/i];

function containsAny(text, words) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function detectFirebase(text, paths) {
  const hits = [];
  if (containsAny(text, ['firebaseConfig', 'initializeApp', 'getDatabase', 'databaseURL', 'firebaseio.com'])) hits.push('Firebase im Code erkannt');
  if (paths.some((p) => ['firebase.json', '.firebaserc', 'database.rules.json', 'firestore.rules'].includes(p))) hits.push('Firebase-Konfigurationsdateien vorhanden');
  const dbUrls = unique([...text.matchAll(/https:\/\/[^\s"']*firebaseio\.com/gi)].map((m) => m[0]));
  const projectIds = unique([
    ...text.matchAll(/projectId\s*[:=]\s*["']([^"']+)["']/gi),
    ...text.matchAll(/"default"\s*:\s*"([^"]+)"/gi)
  ].map((m) => m[1]));
  return { hits, dbUrls, projectIds };
}

function detectBots(text, paths) {
  const hits = [];
  if (containsAny(text, ['telegram', 'botfather', 'node-telegram-bot-api', 'telegraf', 'sendMessage'])) hits.push('Telegram-Bot Hinweise erkannt');
  if (paths.some((p) => /bot\.(js|ts|py)$/i.test(p))) hits.push('Bot-Dateien vorhanden');
  if (containsAny(text, ['pm2', 'ecosystem.config', 'systemd', 'docker-compose'])) hits.push('Server-Prozess Hinweise erkannt');
  return hits;
}

function detectHosting(text, paths, repo) {
  const hits = [];
  if (paths.includes('index.html')) hits.push('statische Website möglich');
  if (paths.some((p) => p.startsWith('.github/workflows/'))) hits.push('GitHub Actions vorhanden');
  if (repo?.has_pages) hits.push('GitHub Pages ist laut GitHub aktiv');
  if (containsAny(text, ['github.io', 'gh-pages'])) hits.push('GitHub Pages Hinweise im Code');
  return hits;
}

function detectTech(paths, fileContents) {
  const tech = [];
  if (paths.some((p) => p.endsWith('.html'))) tech.push('HTML');
  if (paths.some((p) => p.endsWith('.css'))) tech.push('CSS');
  if (paths.some((p) => p.endsWith('.js'))) tech.push('JavaScript');
  if (paths.some((p) => p.endsWith('.ts'))) tech.push('TypeScript');
  if (paths.some((p) => p.endsWith('.jsx') || p.endsWith('.tsx'))) tech.push('React');
  if (paths.includes('package.json')) {
    const pkg = fileContents['package.json'];
    if (pkg?.includes('vite')) tech.push('Vite');
    if (pkg?.includes('next')) tech.push('Next.js');
    if (pkg?.includes('express')) tech.push('Express');
  }
  if (paths.some((p) => p.endsWith('.py'))) tech.push('Python');
  return unique(tech);
}

function createGuardrails(analysis) {
  const rules = ['Bestehende Funktionen erhalten und Änderungen nicht blind auf andere Projekte übertragen.'];
  if (analysis.firebase.hits.length) rules.push('Firebase Rules und Datenbankstruktur nie ohne Gesamtstand vollständig ersetzen. Änderungen immer ergänzend integrieren.');
  if (analysis.dependencies.sharedFirebase.length) rules.push('Diese Firebase-Ressource wird wahrscheinlich von mehreren Projekten genutzt. Andere Tools dürfen nicht beschädigt werden.');
  if (analysis.secretWarnings.length) rules.push('Secrets, Tokens, Private Keys und Passwörter nicht in ZIPs oder Chat-Ausgaben übernehmen.');
  if (analysis.hosting.length) rules.push('Bei GitHub-Pages-Projekten relative Pfade und statisches Hosting beachten.');
  return rules;
}

export function analyzeRepository(repo, tree, fileContents, knownProjects = []) {
  const paths = tree.filter((item) => item.type === 'blob').map((item) => item.path);
  const combinedText = Object.values(fileContents).join('\n\n').slice(0, 800000);
  const firebase = detectFirebase(combinedText, paths);
  const botHits = detectBots(combinedText, paths);
  const hosting = detectHosting(combinedText, paths, repo);
  const tech = detectTech(paths, fileContents);
  const importantFiles = paths.filter((path) => IMPORTANT_FILES.some((needle) => path === needle || path.startsWith(`${needle}/`) || path.endsWith(`/${needle}`))).slice(0, 80);
  const secretWarnings = Object.entries(fileContents)
    .filter(([path, content]) => !path.includes('.env.example') && SECRET_PATTERNS.some((pattern) => pattern.test(content)))
    .map(([path]) => path);
  const todos = unique([...combinedText.matchAll(/TODO[:\s-]+(.{0,100})/gi)].map((m) => m[1]?.trim())).slice(0, 20);

  const sharedFirebase = knownProjects
    .filter((project) => project.fullName !== repo.full_name)
    .filter((project) => {
      const other = project.analysis?.firebase || {};
      return firebase.dbUrls.some((url) => other.dbUrls?.includes(url)) || firebase.projectIds.some((id) => other.projectIds?.includes(id));
    })
    .map((project) => project.fullName);

  const analysis = {
    repoName: repo.name,
    fullName: repo.full_name,
    description: repo.description || '',
    defaultBranch: repo.default_branch,
    private: repo.private,
    htmlUrl: repo.html_url,
    pagesUrl: repo.has_pages ? `https://${repo.owner.login}.github.io/${repo.name}/` : '',
    updatedAt: repo.updated_at,
    fileCount: paths.length,
    tech,
    firebase,
    bots: botHits,
    hosting,
    importantFiles,
    secretWarnings,
    todos,
    dependencies: { sharedFirebase },
    health: [],
    scannedAt: new Date().toISOString()
  };

  analysis.health = [
    { label: 'README vorhanden', status: paths.includes('README.md') ? 'ok' : 'warn' },
    { label: 'GitHub Pages', status: repo.has_pages || hosting.length ? 'ok' : 'warn' },
    { label: 'Firebase erkannt', status: firebase.hits.length ? 'ok' : 'warn' },
    { label: 'Secrets im Code', status: secretWarnings.length ? 'danger' : 'ok' },
    { label: 'TODOs gefunden', status: todos.length ? 'warn' : 'ok' }
  ];
  analysis.guardrails = createGuardrails(analysis);
  return analysis;
}

export function pickFilesForScan(tree) {
  const paths = tree.filter((item) => item.type === 'blob').map((item) => item.path);
  const wanted = paths.filter((path) => {
    if (path.includes('node_modules/') || path.includes('dist/') || path.includes('build/')) return false;
    if (IMPORTANT_FILES.some((needle) => path === needle || path.startsWith(`${needle}/`) || path.endsWith(`/${needle}`))) return true;
    if (/\.(js|ts|jsx|tsx|json|html|css|md|yml|yaml|rules|py)$/i.test(path)) return true;
    return false;
  });
  return wanted.slice(0, 80);
}
