const TEXT_EXT = /\.(html|js|ts|tsx|jsx|json|md|css|yml|yaml|env|txt|rules|cjs|mjs|py|service|toml|ini|conf)$/i;
const MAX_FILES = 260;
const MAX_FILE_SIZE = 520000;
const uniq = arr => [...new Set(arr.filter(Boolean))];
const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const findAll = (re, txt) => [...String(txt || '').matchAll(re)].map(m => m[1] || m[0]);

export function shouldReadFile(item) {
  return item.type === 'blob' && TEXT_EXT.test(item.path) && (item.size || 0) <= MAX_FILE_SIZE && !/node_modules|dist|build|vendor|\.min\.js|package-lock\.json|pnpm-lock|yarn\.lock/i.test(item.path);
}

export function limitReadable(tree) {
  return tree.filter(shouldReadFile).sort((a,b) => scorePath(a.path) - scorePath(b.path)).slice(0, MAX_FILES);
}

function scorePath(p) {
  if (/^(README\.md|index\.html|package\.json|firebase\.json|database\.rules\.json|firestore\.rules|\.env\.example)$/i.test(p)) return 0;
  if (/^(src|server|app|pages|components|lib|scripts|functions|public)\//i.test(p)) return 1;
  if (/firebase|database|rules|config|main|app|index|vite|next|nuxt|requirements|\.service|docker|nginx/i.test(p)) return 2;
  return 5;
}

export function analyzeRepository(repo, files, allKnownProjects = []) {
  const safeFiles = files || [];
  const paths = safeFiles.map(f => f.path);
  const joined = safeFiles.map(f => `\n--- ${f.path} ---\n${f.content || ''}`).join('\n');
  const codeFiles = safeFiles.filter(f => !/^README\.md$/i.test(f.path) && !/\.md$/i.test(f.path));
  const codeJoined = codeFiles.map(f => `\n--- ${f.path} ---\n${f.content || ''}`).join('\n');
  const codeInsights = inferCodeInsights(repo, safeFiles, codeJoined, joined);
  const tech = inferTech(paths, joined, codeInsights);
  const firebase = inferFirebase(joined);
  const bots = inferBots(joined, repo);
  const projectSpace = inferProjectSpace(repo, joined, codeInsights);
  const purpose = inferPurpose(repo, codeInsights, projectSpace);
  const architecture = inferArchitecture(paths, joined, repo, codeInsights);
  const dataModel = inferDataModel(joined, codeInsights);
  const routes = inferRoutes(joined);
  const importantFiles = paths.filter(p => /^(index\.html|package\.json|firebase\.json|database\.rules\.json|README\.md|\.env\.example|\.github\/workflows|server|src\/|app\.py|main\.py|requirements\.txt|vite\.config|tailwind|nginx|docker|Dockerfile)/i.test(p)).slice(0, 100);
  const todos = uniq(findAll(/\b(?:TODO|FIXME|HACK)\b[:\s-]*(.{0,160})/gi, joined).map(clean)).slice(0, 40);
  const secrets = detectSecrets(safeFiles);
  const sharedFirebase = allKnownProjects.filter(p => p.fullName !== repo.fullName && (p.analysis?.firebase?.projectIds || []).some(id => firebase.projectIds.includes(id))).map(p => ({ fullName:p.fullName, space:p.analysis?.projectSpace?.name || 'Unbekannt' }));
  const related = inferRelated(repo, projectSpace, firebase, allKnownProjects);
  const ownershipNotes = inferOwnershipNotes(projectSpace);
  const scanQuality = inferScanQuality(safeFiles, codeInsights);
  const conflicts = inferConflicts(repo, codeInsights, projectSpace);
  const health = [
    { label:'README vorhanden', status: paths.some(p => /^README\.md$/i.test(p)) ? 'ok' : 'warn' },
    { label:'GitHub Pages', status: repo.hasPages ? 'ok' : 'neutral' },
    { label:'Firebase erkannt', status: firebase.detected ? 'ok' : 'neutral' },
    { label:'Kritische Secrets im Code', status: secrets.length ? 'danger' : 'ok' },
    { label:'TODOs gefunden', status: todos.length ? 'warn' : 'ok' },
    { label:'Scan-Konfidenz', status: scanQuality.confidence === 'hoch' ? 'ok' : scanQuality.confidence === 'mittel' ? 'warn' : 'danger' },
    { label:'Konflikte', status: conflicts.length ? 'warn' : 'ok' }
  ];
  const wiki = buildWiki({ repo, purpose, tech, firebase, bots, projectSpace, ownershipNotes, importantFiles, architecture, secrets, sharedFirebase, dataModel, routes, todos, codeInsights, scanQuality, conflicts });
  return {
    repoName: repo.name, fullName: repo.fullName, purpose, defaultBranch: repo.defaultBranch, htmlUrl: repo.htmlUrl,
    pagesUrl: repo.hasPages ? `https://${repo.fullName.split('/')[0]}.github.io/${repo.name}/` : '', updatedAt: repo.updatedAt,
    fileCount: paths.length, scannedFiles: safeFiles.length, tech, projectSpace, ownershipNotes,
    firebase: { ...firebase, sharedWith: sharedFirebase }, bots, routes, dataModel, codeInsights, scanQuality,
    conflicts, relatedProjects: related, hosting: repo.hasPages ? ['GitHub Pages aktiv'] : [], importantFiles,
    architecture, secretWarnings: secrets, todos, health, wiki, scannedAt: new Date().toISOString(),
    guardrails: buildGuardrails(projectSpace, firebase, repo, codeInsights, conflicts)
  };
}

function inferCodeInsights(repo, files, codeJoined, joined) {
  const repoName = String(repo.name || '').toLowerCase();
  const codeLower = codeJoined.toLowerCase();
  const allLower = joined.toLowerCase();
  const packageInfo = readPackage(files);
  const htmlInfo = readHtml(files);
  const functions = uniq([
    ...findAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g, codeJoined),
    ...findAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g, codeJoined),
    ...findAll(/window\.([A-Za-z_$][\w$]*)\s*=/g, codeJoined),
    ...findAll(/([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/g, codeJoined)
  ]).filter(x => !/^anonymous$|^then$|^catch$|^map$|^filter$/.test(x)).slice(0, 100);
  const stateKeys = uniq([
    ...findAll(/\b(?:state|data|config|settings)\.([A-Za-z_$][\w$]*)/g, codeJoined),
    ...findAll(/\b([A-Za-z_$][\w$]*(?:Queue|Offer|Deal|Product|Item|Team|Round|League|Event|Score|Price|Stock|Order|Angebot|Preis|Bestand|Watchlist|Display|Card)[A-Za-z_$0-9]*)\b/g, codeJoined)
  ]).slice(0, 100);
  const storageKeys = uniq([
    ...findAll(/localStorage\.(?:getItem|setItem|removeItem)\(["'`]([^"'`]+)["'`]/g, codeJoined),
    ...findAll(/sessionStorage\.(?:getItem|setItem|removeItem)\(["'`]([^"'`]+)["'`]/g, codeJoined)
  ]).slice(0, 80);
  const uiLabels = uniq([
    ...findAll(/<button[^>]*>([^<]{2,100})<\/button>/gi, codeJoined).map(clean),
    ...findAll(/placeholder=["'`]([^"'`]{2,100})["'`]/gi, codeJoined).map(clean),
    ...findAll(/aria-label=["'`]([^"'`]{2,100})["'`]/gi, codeJoined).map(clean),
    ...findAll(/<h[1-4][^>]*>([^<]{2,120})<\/h[1-4]>/gi, codeJoined).map(clean),
    ...findAll(/<title[^>]*>([^<]{2,120})<\/title>/gi, codeJoined).map(clean)
  ]).filter(x => !/[{};]/.test(x)).slice(0, 100);
  const endpointUrls = uniq([
    ...findAll(/fetch\(["'`]([^"'`]+)["'`]/g, codeJoined),
    ...findAll(/axios\.(?:get|post|put|delete|patch)\(["'`]([^"'`]+)["'`]/g, codeJoined),
    ...findAll(/app\.(?:get|post|put|delete|patch)\(["'`]([^"'`]+)["'`]/g, codeJoined)
  ]).slice(0, 80);
  const scores = scoreDomains(repoName, codeLower, allLower, { functions, stateKeys, uiLabels, packageInfo, htmlInfo, endpointUrls });
  const sortedScores = Object.entries(scores).sort((a,b) => b[1] - a[1]);
  const topScore = sortedScores[0]?.[1] || 0;
  const domains = sortedScores.filter(([_,s]) => s >= Math.max(3, topScore * 0.45)).map(([d]) => d);
  const topTerms = extractTopTerms(codeJoined, repoName);
  const fileSummaries = files.map(f => summarizeFile(f)).filter(Boolean).slice(0, 80);
  const evidence = buildEvidence(scores, { functions, stateKeys, uiLabels, packageInfo, htmlInfo, endpointUrls, topTerms });
  const signature = uniq([
    packageInfo.name ? `package:${packageInfo.name}` : '',
    htmlInfo.title ? `title:${htmlInfo.title}` : '',
    ...domains.map(d => `domain:${d} (${scores[d]})`),
    ...functions.slice(0, 14).map(f => `fn:${f}`),
    ...stateKeys.slice(0, 14).map(k => `key:${k}`),
    ...uiLabels.slice(0, 10).map(l => `ui:${l}`),
    ...endpointUrls.slice(0, 8).map(u => `route:${u}`)
  ]).slice(0, 60);
  return { domains: uniq(domains), domainScores:scores, topDomain: sortedScores[0]?.[0] || 'unknown', topScore, functions, stateKeys, storageKeys, uiLabels, endpointUrls, signature, fileSummaries, packageInfo, htmlInfo, topTerms, evidence };
}

function readPackage(files) {
  const f = files.find(x => x.path === 'package.json');
  if (!f) return {};
  try { const p = JSON.parse(f.content); return { name:p.name, description:p.description, scripts:p.scripts ? Object.keys(p.scripts) : [], dependencies:Object.keys({ ...(p.dependencies || {}), ...(p.devDependencies || {}) }).slice(0, 60) }; } catch { return {}; }
}
function readHtml(files) {
  const html = files.find(f => /index\.html$/i.test(f.path)) || files.find(f => /\.html$/i.test(f.path));
  if (!html) return {};
  return { title: clean(findAll(/<title[^>]*>([^<]+)<\/title>/i, html.content)[0]), headings: uniq(findAll(/<h[1-4][^>]*>([^<]+)<\/h[1-4]>/gi, html.content).map(clean)).slice(0, 20) };
}

function scoreDomains(repoName, codeLower, allLower, ctx) {
  const code = ` ${codeLower} `;
  const all = ` ${repoName} ${allLower} `;
  const scores = { 'offer-tracking':0, 'queue-management':0, 'market-tools':0, scoreboard:0, 'stream-tools':0, bot:0, watcher:0, website:0, 'developer-tool':0 };
  const add = (domain, regex, weight, hay = code) => { const m = hay.match(regex); if (m) scores[domain] += m.length * weight; };
  add('offer-tracking', /\b(angebot|angebote|offer|offers|deal|deals|angebotspreis|ankauf|ankaufsangebot|buyer|seller|kaufangebot|verkaufsangebot|preisvorschlag)\b/g, 3);
  add('offer-tracking', /\b(angebote|angebots|offer|deal)\b/g, 6, ` ${repoName} `);
  add('queue-management', /\b(queue|warteschlange|bestellnummer|currentorder|nextorder|orderinput|remainingorders|orderqueue)\b/g, 3);
  add('queue-management', /\b(queue|tracker)\b/g, 4, ` ${repoName} `);
  add('market-tools', /\b(flohmarkt|bestand|barcode|inventory|stock|produkt|product|preis|price|lager|artikel|verkauf|sales|cardmarket)\b/g, 2);
  add('scoreboard', /\b(scoreboard|punkte|punktestand|round|runde|team|teams|liga|league|moderator|quizt|quizabend|eventcode)\b/g, 3);
  add('stream-tools', /\b(stream|overlay|twitch|obs|chat|viewer|pullcounter|roadtoglo|wheel)\b/g, 3);
  add('bot', /\b(telegram|bot|webhook|sendmessage|bot_token|discord)\b/g, 4);
  add('watcher', /\b(watcher|watchlist|scraper|playwright|chromium|headless|monitor|notify|notification)\b/g, 4);
  add('website', /\b(nav|hero|section|contact|impressum|datenschutz|landing|website|homepage)\b/g, 1);
  add('developer-tool', /\b(github|repository|repo|deploy|rollback|scanner|developer hub|projektgedächtnis|secret|token)\b/g, 3);
  for (const f of ctx.functions) {
    const s = f.toLowerCase();
    if (/offer|angebot|deal/.test(s)) scores['offer-tracking'] += 5;
    if (/queue|order/.test(s)) scores['queue-management'] += 5;
    if (/score|team|round|league|event/.test(s)) scores.scoreboard += 5;
    if (/product|price|stock|inventory|barcode/.test(s)) scores['market-tools'] += 4;
    if (/repo|scan|deploy|rollback|secret|github/.test(s)) scores['developer-tool'] += 4;
  }
  for (const u of ctx.uiLabels) {
    const s = u.toLowerCase();
    if (/angebot|offer|deal|preisvorschlag/.test(s)) scores['offer-tracking'] += 4;
    if (/queue|bestell|warteschlange/.test(s)) scores['queue-management'] += 4;
    if (/team|runde|punkte|liga|quiz/.test(s)) scores.scoreboard += 4;
    if (/produkt|bestand|preis|barcode/.test(s)) scores['market-tools'] += 3;
  }
  return scores;
}

function buildEvidence(scores, ctx) {
  const out = [];
  for (const [domain, score] of Object.entries(scores).sort((a,b)=>b[1]-a[1])) {
    if (score <= 0) continue;
    out.push({ domain, score, examples: uniq([
      ...ctx.functions.filter(x => domainRegex(domain).test(x)).slice(0, 5).map(x => `Funktion ${x}`),
      ...ctx.stateKeys.filter(x => domainRegex(domain).test(x)).slice(0, 5).map(x => `Key ${x}`),
      ...ctx.uiLabels.filter(x => domainRegex(domain).test(x)).slice(0, 5).map(x => `UI ${x}`)
    ]).slice(0, 10) });
  }
  return out;
}
function domainRegex(domain) {
  const map = {
    'offer-tracking': /angebot|offer|deal|ankauf|preis/i,
    'queue-management': /queue|order|bestell|warteschlange/i,
    'market-tools': /produkt|product|stock|bestand|price|preis|barcode|inventory/i,
    scoreboard: /score|team|round|runde|league|liga|quiz|punkte/i,
    'stream-tools': /stream|overlay|twitch|obs|pull/i,
    bot: /telegram|bot|webhook/i,
    watcher: /watch|scrap|playwright|monitor/i,
    'developer-tool': /repo|github|deploy|rollback|secret|scan|project/i
  };
  return map[domain] || /a^/;
}

function extractTopTerms(text, repoName) {
  const stop = new Set('const let var function return await async true false null undefined class import export from href src div span button input value document window this that with eine einem einer der die das und oder for if else try catch then map filter reduce length push set get query selector inner html text content display style color background margin padding font data state config item items index event target click change submit type name id class aria label title placeholder github chief baliman'.split(' '));
  const words = String(text || '').replace(/[A-Z]/g, m => ` ${m.toLowerCase()}`).toLowerCase().match(/[a-zäöüß][a-zäöüß0-9_-]{3,}/g) || [];
  const counts = new Map();
  for (const w of words) { const k = w.replace(/[-_]/g, ''); if (!stop.has(k) && !/^\d+$/.test(k)) counts.set(k, (counts.get(k)||0)+1); }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 30).map(([term,count]) => ({ term, count }));
}

function inferTech(paths, joined, insights) {
  const lower = joined.toLowerCase();
  const tech = [];
  if (paths.some(p => p.endsWith('.html')) || lower.includes('<!doctype html')) tech.push('HTML');
  if (paths.some(p => /\.(js|mjs|cjs)$/.test(p))) tech.push('JavaScript');
  if (paths.some(p => /\.(ts|tsx)$/.test(p))) tech.push('TypeScript');
  if (paths.includes('package.json')) tech.push('Node.js');
  if (/\bvite\b/.test(lower)) tech.push('Vite');
  if (/\breact\b/.test(lower)) tech.push('React');
  if (/\bexpress\b|app\.(get|post|put|delete)/.test(lower)) tech.push('Express');
  if (/firebase/.test(lower)) tech.push('Firebase');
  if (/telegram/.test(lower)) tech.push('Telegram Bot');
  if (paths.some(p => p.endsWith('.py')) || /python/.test(lower)) tech.push('Python');
  if (/gunicorn/.test(lower)) tech.push('Gunicorn');
  if (/playwright/.test(lower)) tech.push('Playwright');
  if (paths.some(p => p.includes('.github/workflows'))) tech.push('GitHub Actions');
  if (insights.domains.includes('offer-tracking')) tech.push('Angebots-Tracking');
  if (insights.domains.includes('queue-management')) tech.push('Queue-Verwaltung');
  if (insights.domains.includes('scoreboard')) tech.push('Scoreboard');
  return uniq(tech);
}

function inferFirebase(joined) {
  const projectIds = uniq(findAll(/projectId\s*[:=]\s*["'`]([^"'`]+)["'`]/g, joined));
  const dbUrls = uniq(findAll(/databaseURL\s*[:=]\s*["'`]([^"'`]+)["'`]/g, joined));
  const paths = uniq([
    ...findAll(/ref\(\s*db\s*,\s*["'`]([^"'`]+)["'`]\s*\)/g, joined),
    ...findAll(/ref\(\s*database\s*,\s*["'`]([^"'`]+)["'`]\s*\)/g, joined),
    ...findAll(/(?:set|update|push|onValue|get|remove)\(\s*ref\([^,]+,\s*["'`]([^"'`]+)["'`]/g, joined),
    ...findAll(/(?:collection|doc)\(\s*[^,]+,\s*["'`]([^"'`]+)["'`]/g, joined)
  ]).filter(p => !/^https?:/.test(p) && !p.includes('${'));
  const rulesMentioned = /database\.rules|\.read|\.write|firebase rules|rules_version/i.test(joined);
  return { detected: Boolean(projectIds.length || dbUrls.length || /firebase/i.test(joined)), projectIds, dbUrls, paths, rulesMentioned };
}

function inferBots(joined, repo) {
  const botSignals = [];
  if (/telegram/i.test(joined + repo.name)) botSignals.push('Telegram im Code erwähnt');
  if (/webhook/i.test(joined)) botSignals.push('Webhook-Struktur erkannt');
  if (/systemd|\.service|gunicorn|pm2/i.test(joined)) botSignals.push('Server-Dienst-Struktur erkannt');
  if (/playwright|chromium|watcher|scraper/i.test(joined + repo.name)) botSignals.push('Watcher/Scraper-Struktur erkannt');
  return botSignals;
}

function inferProjectSpace(repo, txt, insights) {
  const name = `${repo.fullName} ${repo.name}`.toLowerCase();
  const lower = txt.toLowerCase();
  if (/quizt|quiz_mit_twist|streetlife|quizabend/.test(name + ' ' + lower) || insights.domains.includes('scoreboard')) return { key:'quizt', name:'Quizt / Laura', type:'externes Projekt', owner:'Laura / Quizt', separation:'Nicht mit ChiefCards vermischen. Fabian entwickelt Technik, aber Quizt ist inhaltlich und organisatorisch ein eigenes Projekt.' };
  if (insights.domains.includes('bot') || insights.domains.includes('watcher') || /vps|server|gunicorn|systemd/.test(name + ' ' + lower)) return { key:'server', name:'Server / Bots', type:'Infrastruktur', owner:'Fabian', separation:'Servernahe Dienste getrennt von einzelnen Markenprojekten dokumentieren.' };
  if (/chiefcards|chief-bali|queue|stream|offer|angebot|flohmarkt|bulk|cardmarket|otakuya|jp-display|ofcs/.test(name + ' ' + lower) || insights.domains.some(d => ['offer-tracking','queue-management','market-tools','stream-tools'].includes(d))) return { key:'chiefcards', name:'ChiefCards / Fabian', type:'eigenes Business', owner:'Fabian / ChiefCards', separation:'Gehört zu ChiefCards, Stream, Shop, Kartenhandel oder internen Tools.' };
  return { key:'unknown', name:'Unsortiert', type:'noch einordnen', owner:'unbekannt', separation:'Projektgruppe manuell prüfen.' };
}

function inferOwnershipNotes(space) {
  if (space.key === 'quizt') return ['Quizt ist ein externes Projekt für Laura und gehört nicht zu ChiefCards.', 'Branding, Sprache, Socials und Geschäftslogik nicht mit ChiefCards, ChiefBaliman oder Kartenhandel vermischen.', 'Technische Infrastruktur darf gemeinsam genutzt werden, muss im Kontext aber als externe Abhängigkeit markiert werden.'];
  if (space.key === 'chiefcards') return ['Gehört zum ChiefCards/ChiefBaliman-Umfeld.', 'Kann mit Stream-, Shop-, Karten- und Flohmarkt-Tools zusammen betrachtet werden.'];
  if (space.key === 'server') return ['Serverdienst oder Bot. Vor Änderungen prüfen, ob systemd, Ports oder bestehende Dienste betroffen sind.', 'Nicht mit einem einzelnen Markenprojekt vermischen, wenn der Dienst mehrere Projekte unterstützt.'];
  return ['Projektgruppe noch nicht sicher erkannt. Vor größeren Änderungen manuell einordnen.'];
}

function inferPurpose(repo, insights, space) {
  const top = insights.topDomain;
  const title = insights.htmlInfo?.title || insights.packageInfo?.name || repo.name;
  if (space.key === 'quizt') return top === 'scoreboard' ? 'Quizt-Anwendung für Punkteübersicht, Moderation, Events oder Liga. Externes Projekt für Laura, nicht ChiefCards.' : 'Quizt-Website oder Quizt-Tool. Externes Projekt für Laura, getrennt von ChiefCards.';
  if (top === 'offer-tracking') return `${title}: Tool zur Verwaltung, Beobachtung oder Bewertung von Angeboten, Deals oder Preisvorschlägen.`;
  if (top === 'queue-management') return `${title}: Queue-/Warteschlangen-Tool zur Verwaltung von Bestellungen oder Reihenfolge, vermutlich mit Overlay/Live-Ansicht.`;
  if (top === 'market-tools') return `${title}: Tool für Produkte, Preise, Bestände, Barcode/Inventar oder Verkaufsverwaltung.`;
  if (top === 'scoreboard') return `${title}: Scoreboard-, Punkte-, Team- oder Liga-Anwendung.`;
  if (top === 'stream-tools') return `${title}: Stream-/Overlay-Tool für Twitch, OBS oder Live-Inhalte.`;
  if (top === 'bot') return `${title}: Bot-Anwendung mit Telegram, Webhook oder Messaging-Anbindung.`;
  if (top === 'watcher') return `${title}: Watcher/Scraper zur Beobachtung von Produkten, Webseiten oder Änderungen.`;
  if (top === 'developer-tool') return `${title}: Developer-Hub oder Verwaltungswerkzeug für Repositories, Deployments, Secrets oder Projektkontext.`;
  return repo.description || `${title}: Zweck nicht sicher erkannt. Scanner hat nicht genug eindeutige Code-Signale gefunden.`;
}

function inferArchitecture(paths, txt, repo, insights) {
  const lower = txt.toLowerCase();
  const a = [];
  if (paths.length === 1 && paths.includes('index.html')) a.push('Ein-Datei-App: index.html enthält Oberfläche, Logik und Styles. Scanner hat den tatsächlichen Inhalt dieser Datei ausgewertet.');
  if (paths.includes('package.json') && paths.some(p => p.startsWith('server/'))) a.push('Node/Express-App mit Backend-Struktur.');
  if (paths.some(p => p.startsWith('public/'))) a.push('Frontend-Dateien liegen im public-Verzeichnis.');
  if (/firebasejs|gstatic\.com\/firebasejs/.test(lower)) a.push('Firebase wird clientseitig per CDN eingebunden.');
  if (/getdatabase|realtime|onvalue|ref\(/.test(lower)) a.push('Nutzt Firebase Realtime Database.');
  if (/urlsearchparams/.test(lower)) a.push('URL-Parameter steuern Modi oder Ansichten.');
  if (repo.hasPages) a.push('GitHub Pages ist laut Repository aktiv.');
  if (insights.functions.length) a.push(`Wichtige Funktionen erkannt: ${insights.functions.slice(0, 12).join(', ')}.`);
  if (insights.uiLabels.length) a.push(`UI-Texte/Buttons: ${insights.uiLabels.slice(0, 12).join(', ')}.`);
  if (insights.evidence.length) a.push(`Stärkste Domänen-Erkennung: ${insights.evidence.slice(0,3).map(e => `${e.domain} (${e.score})`).join(', ')}.`);
  return a;
}

function inferDataModel(txt, insights) {
  return uniq([...insights.stateKeys, ...insights.storageKeys, ...findAll(/(?:const|let|var)\s+([A-Za-z0-9_]*(?:State|Data|Config|Event|Team|Queue|Product|League|Offer|Deal|Angebot|Preis|Bestand)[A-Za-z0-9_]*)\s*=/g, txt)]).slice(0, 80);
}
function inferRoutes(txt) { return uniq([...findAll(/app\.(?:get|post|put|delete|patch)\(["'`]([^"'`]+)["'`]/g, txt), ...findAll(/fetch\(["'`]([^"'`]+)["'`]/g, txt)]).slice(0, 80); }
function inferRelated(repo, space, firebase, allKnownProjects) { return allKnownProjects.filter(p => p.fullName !== repo.fullName).map(p => { const sameFirebase = (p.analysis?.firebase?.projectIds || []).some(id => firebase.projectIds.includes(id)); const sameSpace = p.analysis?.projectSpace?.key && p.analysis.projectSpace.key === space.key; if (!sameFirebase && !sameSpace) return null; return { fullName:p.fullName, reason:sameFirebase ? 'teilt Firebase-Ressource' : 'gleiche Projektgruppe', space:p.analysis?.projectSpace?.name || 'Unbekannt', hardDependency:sameFirebase }; }).filter(Boolean); }

function summarizeFile(f) {
  const txt = f.content || ''; const lower = txt.toLowerCase(); const parts = [];
  if (/firebase/.test(lower)) parts.push('Firebase');
  if (/getdatabase|realtime|onvalue|ref\(/.test(lower)) parts.push('Realtime DB');
  if (/angebot|offer|deal|ankauf/.test(lower)) parts.push('Angebote/Deals');
  if (/queue|warteschlange|order|bestellnummer/.test(lower)) parts.push('Queue/Bestellungen');
  if (/team|runde|score|liga|league|quiz/.test(lower)) parts.push('Quiz/Score');
  if (/express|app\.get|app\.post/.test(lower)) parts.push('Backend/API');
  if (/telegram|bot/.test(lower)) parts.push('Bot');
  if (/playwright|watcher|scraper/.test(lower)) parts.push('Watcher/Scraper');
  if (!parts.length) return null;
  return `${f.path}: ${parts.join(', ')}`;
}
function inferScanQuality(files, insights) { const html = files.filter(f => f.path.endsWith('.html')).length; const js = files.filter(f => /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(f.path)).length; const meaningful = insights.functions.length + insights.stateKeys.length + insights.uiLabels.length + insights.endpointUrls.length + insights.domains.length; const confidence = insights.topScore >= 15 && meaningful >= 8 ? 'hoch' : insights.topScore >= 6 || meaningful >= 6 ? 'mittel' : 'niedrig'; return { filesRead: files.length, htmlFiles: html, codeFiles: js, extractedSignals: meaningful, topDomain: insights.topDomain, topDomainScore: insights.topScore, confidence }; }
function inferConflicts(repo, insights, space) { const c = []; const scores = insights.domainScores || {}; if ((scores['offer-tracking'] || 0) >= 8 && (scores['queue-management'] || 0) >= 8) c.push('Sowohl Angebots-/Deal-Signale als auch Queue-Signale gefunden. Zweck manuell prüfen.'); if (/angebot|offer|deal/i.test(repo.name) && insights.topDomain === 'queue-management') c.push('Repo-Name deutet auf Angebote hin, Code-Analyse aber auf Queue. Mögliches altes README oder falscher Upload.'); if (/queue/i.test(repo.name) && insights.topDomain === 'offer-tracking') c.push('Repo-Name deutet auf Queue hin, Code-Analyse aber auf Angebote. Mögliches altes README oder falscher Upload.'); if (space.key === 'quizt' && scores['market-tools'] > scores.scoreboard) c.push('Quizt wurde erkannt, aber Code enthält starke Shop/Produkt-Signale. Projektgruppe prüfen.'); return c; }
function detectSecrets(files) { const secrets = []; for (const f of files) { if (/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(f.content)) secrets.push(`${f.path}: Private Key`); if (/ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+/.test(f.content)) secrets.push(`${f.path}: GitHub Token`); if (/\d{6,12}:[A-Za-z0-9_-]{25,}/.test(f.content)) secrets.push(`${f.path}: möglicher Telegram Bot Token`); if (/password\s*=\s*["'][^"']{8,}["']/i.test(f.content)) secrets.push(`${f.path}: mögliches Passwort`); } return secrets; }
function buildGuardrails(space, firebase, repo, insights, conflicts) { const base = ['Bestehende Funktionen erhalten und Änderungen gezielt einbauen.', 'Secrets, Tokens, Private Keys und Passwörter nicht in ZIPs, Code oder Chat-Ausgaben übernehmen.', 'ZIP-Deploy überschreibt nur Pfade aus der ZIP. Nicht enthaltene Repo-Dateien bleiben bestehen.', 'Vor Änderungen die Code-Signatur beachten und Zweck nicht aus anderen Projekten übernehmen.']; if (conflicts.length) base.unshift('Scanner hat widersprüchliche Signale gefunden. Vor Änderungen Zweck und richtige Dateien prüfen.'); if (firebase.detected) base.push('Firebase Rules und Datenbankstruktur nie ohne Gesamtstand vollständig ersetzen. Änderungen immer integrieren.'); if (repo.hasPages) base.push('Bei GitHub-Pages-Projekten relative Pfade und statisches Hosting beachten.'); if (space.key === 'quizt') base.unshift('Quizt ist extern für Laura. Nicht mit ChiefCards, ChiefBaliman, Shop, Kartenhandel oder Stream-Branding vermischen.'); if (insights.topDomain === 'offer-tracking') base.push('Dieses Projekt ist Angebots-/Deal-Tracking. Nicht als Queue-Tracker oder Bestellwarteschlange behandeln.'); if (insights.topDomain === 'queue-management') base.push('Dieses Projekt verwaltet eine Queue/Warteschlange. Reihenfolge, aktuelle Bestellung und Overlay-Modus erhalten.'); return base; }

function buildWiki(x) {
  const evidence = x.codeInsights.evidence.length ? x.codeInsights.evidence.map(e => `- ${e.domain}: Score ${e.score}${e.examples.length ? ` (${e.examples.join('; ')})` : ''}`).join('\n') : '- Keine belastbaren Belege erkannt';
  const terms = x.codeInsights.topTerms.length ? x.codeInsights.topTerms.slice(0,20).map(t => `- ${t.term}: ${t.count}`).join('\n') : '- Keine Begriffe ermittelt';
  return `# ${x.repo.fullName}\n\n## Projektgruppe\n- Bereich: ${x.projectSpace.name}\n- Typ: ${x.projectSpace.type}\n- Verantwortlich: ${x.projectSpace.owner}\n- Trennung: ${x.projectSpace.separation}\n\n## Zweck\n${x.purpose}\n\n## Scan-Qualität\n- Gelesene Dateien: ${x.scanQuality.filesRead}\n- Code-Dateien: ${x.scanQuality.codeFiles}\n- HTML-Dateien: ${x.scanQuality.htmlFiles}\n- Erkannte Code-Signale: ${x.scanQuality.extractedSignals}\n- Top-Domäne: ${x.scanQuality.topDomain}\n- Top-Score: ${x.scanQuality.topDomainScore}\n- Konfidenz: ${x.scanQuality.confidence}\n\n## Belege für Erkennung\n${evidence}\n\n## Konflikte / Prüfpunkte\n${x.conflicts.length ? x.conflicts.map(c => `- ${c}`).join('\n') : '- Keine Konflikte erkannt'}\n\n## Code-Signatur\n${x.codeInsights.signature.length ? x.codeInsights.signature.map(s => `- ${s}`).join('\n') : '- Keine eindeutige Code-Signatur erkannt'}\n\n## Häufige Code-Begriffe\n${terms}\n\n## Besitz- und Kontextregeln\n${x.ownershipNotes.map(n => `- ${n}`).join('\n')}\n\n## Technik\n${x.tech.length ? x.tech.map(t => `- ${t}`).join('\n') : '- Nicht eindeutig erkannt'}\n\n## Hosting\n${x.repo.hasPages ? `- GitHub Pages: https://${x.repo.fullName.split('/')[0]}.github.io/${x.repo.name}/` : '- Kein GitHub Pages erkannt'}\n\n## Firebase\n${x.firebase.projectIds.length ? x.firebase.projectIds.map(p => `- Projekt-ID: ${p}`).join('\n') : '- Keine Projekt-ID erkannt'}\n${x.firebase.dbUrls.length ? x.firebase.dbUrls.map(u => `- Database URL: ${u}`).join('\n') : ''}\n${x.firebase.paths.length ? x.firebase.paths.map(p => `- Datenpfad: ${p}`).join('\n') : ''}\n${x.sharedFirebase.length ? `\nGeteilte Firebase-Ressourcen:\n${x.sharedFirebase.map(p => `- ${p.fullName} (${p.space})`).join('\n')}` : ''}\n\n## Architektur\n${x.architecture.length ? x.architecture.map(a => `- ${a}`).join('\n') : '- Keine sichere Architektur-Zusammenfassung möglich'}\n\n## Erkannte Funktionen\n${x.codeInsights.functions.length ? x.codeInsights.functions.slice(0, 50).map(k => `- ${k}`).join('\n') : '- Keine Funktionen erkannt'}\n\n## Erkannte UI-Texte\n${x.codeInsights.uiLabels.length ? x.codeInsights.uiLabels.slice(0, 50).map(k => `- ${k}`).join('\n') : '- Keine UI-Texte erkannt'}\n\n## Erkannte Datenmodelle / Schlüssel\n${x.dataModel.length ? x.dataModel.map(k => `- ${k}`).join('\n') : '- Keine klaren Datenmodelle erkannt'}\n\n## Erkannte Routen / API-Pfade\n${x.routes.length ? x.routes.map(r => `- ${r}`).join('\n') : '- Keine Routen erkannt'}\n\n## Datei-Zusammenfassung\n${x.codeInsights.fileSummaries.length ? x.codeInsights.fileSummaries.map(f => `- ${f}`).join('\n') : '- Keine Datei-Zusammenfassung möglich'}\n\n## Wichtige Dateien\n${x.importantFiles.length ? x.importantFiles.map(f => `- ${f}`).join('\n') : '- Keine wichtigen Dateien erkannt'}\n\n## Risiken\n${x.secrets.length ? x.secrets.map(s => `- ${s}`).join('\n') : '- Keine kritischen Secrets erkannt'}\n${x.todos.length ? `\n## TODOs\n${x.todos.map(t => `- ${t}`).join('\n')}` : ''}\n\n## Änderungsregeln\n- Bestehende Funktionen erhalten.\n- Projektgruppe beachten und fremde Marken-/Business-Kontexte nicht vermischen.\n- Belege und Top-Domäne beachten. Bei Konflikten erst prüfen, nicht raten.\n- Firebase-Strukturen nicht blind ersetzen.\n- Secrets niemals in ChatGPT-Prompts oder ZIP-Dateien übernehmen.\n`;
}
