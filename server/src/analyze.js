const TEXT_EXT = /\.(html|js|ts|tsx|jsx|json|md|css|yml|yaml|env|txt|rules|cjs|mjs|py|service|toml|ini|conf)$/i;
const MAX_FILES = 400;
const MAX_FILE_SIZE = 900000;
const uniq = arr => [...new Set((arr || []).filter(Boolean))];
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
  const codeFiles = safeFiles.filter(f => !/\.md$/i.test(f.path));
  const joined = safeFiles.map(f => `\n--- ${f.path} ---\n${f.content || ''}`).join('\n');
  const codeJoined = codeFiles.map(f => `\n--- ${f.path} ---\n${f.content || ''}`).join('\n');

  const facts = extractFacts(safeFiles);
  const scores = scoreDomains(repo, facts, codeJoined);
  const domains = rankedDomains(scores);
  const firebase = inferFirebase(facts, joined);
  const tech = inferTech(paths, joined, facts, scores);
  const projectSpace = inferProjectSpace(repo, joined, domains);
  const conflicts = inferConflicts(repo, scores, domains, projectSpace);
  const scanQuality = inferScanQuality(safeFiles, facts, scores, conflicts);
  const purpose = inferPurpose(repo, scores, domains, projectSpace, scanQuality, conflicts);
  const architecture = inferArchitecture(paths, joined, repo, facts, scores);
  const dataModel = inferDataModel(facts, joined);
  const routes = uniq(facts.filter(f => f.kind === 'api').map(f => f.match)).slice(0, 100);
  const bots = inferBots(joined, repo);
  const importantFiles = paths.filter(p => /^(index\.html|package\.json|firebase\.json|database\.rules\.json|README\.md|\.env\.example|\.github\/workflows|server|src\/|app\.py|main\.py|requirements\.txt|vite\.config|tailwind|nginx|docker|Dockerfile)/i.test(p)).slice(0, 140);
  const todos = uniq(findAll(/\b(?:TODO|FIXME|HACK)\b[:\s-]*(.{0,160})/gi, joined).map(clean)).slice(0, 40);
  const secrets = detectSecrets(safeFiles);
  const sharedFirebase = allKnownProjects.filter(p => p.fullName !== repo.fullName && (p.analysis?.firebase?.projectIds || []).some(id => firebase.projectIds.includes(id))).map(p => ({ fullName:p.fullName, space:p.analysis?.projectSpace?.name || 'Unbekannt' }));
  const relatedProjects = allKnownProjects.filter(p => p.fullName !== repo.fullName).map(p => {
    const sameFirebase = (p.analysis?.firebase?.projectIds || []).some(id => firebase.projectIds.includes(id));
    const sameSpace = p.analysis?.projectSpace?.key && p.analysis.projectSpace.key === projectSpace.key;
    return sameFirebase || sameSpace ? { fullName:p.fullName, reason:sameFirebase?'teilt Firebase-Ressource':'gleiche Projektgruppe', space:p.analysis?.projectSpace?.name || 'Unbekannt', hardDependency:sameFirebase } : null;
  }).filter(Boolean);
  const ownershipNotes = inferOwnershipNotes(projectSpace);
  const codeInsights = buildCodeInsights(repo, facts, scores, domains, safeFiles);
  const health = [
    { label:'README vorhanden', status: paths.some(p => /^README\.md$/i.test(p)) ? 'ok' : 'warn' },
    { label:'GitHub Pages', status: repo.hasPages ? 'ok' : 'neutral' },
    { label:'Firebase erkannt', status: firebase.detected ? 'ok' : 'neutral' },
    { label:'Kritische Secrets im Code', status: secrets.length ? 'danger' : 'ok' },
    { label:'TODOs gefunden', status: todos.length ? 'warn' : 'ok' },
    { label:'Scan-Konfidenz', status: scanQuality.confidence === 'hoch' ? 'ok' : scanQuality.confidence === 'mittel' ? 'warn' : 'danger' },
    { label:'Konflikte', status: conflicts.length ? 'warn' : 'ok' }
  ];
  const wiki = buildWiki({ repo, purpose, tech, firebase:{...firebase, sharedWith:sharedFirebase}, bots, projectSpace, ownershipNotes, importantFiles, architecture, secrets, sharedFirebase, dataModel, routes, todos, codeInsights, scanQuality, conflicts });
  return {
    repoName: repo.name, fullName: repo.fullName, purpose, defaultBranch: repo.defaultBranch, htmlUrl: repo.htmlUrl,
    pagesUrl: repo.hasPages ? `https://${repo.fullName.split('/')[0]}.github.io/${repo.name}/` : '', updatedAt: repo.updatedAt,
    fileCount: paths.length, scannedFiles: safeFiles.length, tech, projectSpace, ownershipNotes,
    firebase: { ...firebase, sharedWith: sharedFirebase }, bots, routes, dataModel, codeInsights, scanQuality,
    conflicts, relatedProjects, hosting: repo.hasPages ? ['GitHub Pages aktiv'] : [], importantFiles,
    architecture, secretWarnings: secrets, todos, health, wiki, scannedAt: new Date().toISOString(),
    guardrails: buildGuardrails(projectSpace, firebase, repo, codeInsights, conflicts)
  };
}

function lineNoAt(text, index) { return String(text || '').slice(0, index).split(/\r?\n/).length; }
function getLine(text, index) { const lines = String(text || '').split(/\r?\n/); return clean(lines[Math.max(0, lineNoAt(text, index) - 1)] || '').slice(0, 240); }
function collect(files, patterns, limit = 220) {
  const out = [];
  for (const f of files || []) {
    const content = String(f.content || '');
    const source = /(^|\/)README\.md$/i.test(f.path) || /\.md$/i.test(f.path) ? 'readme' : 'code';
    for (const item of patterns) {
      const re = new RegExp(item.re.source, item.re.flags.includes('g') ? item.re.flags : item.re.flags + 'g');
      let m;
      while ((m = re.exec(content)) && out.length < limit) {
        out.push({ kind:item.kind, label:item.label, file:f.path, line:lineNoAt(content, m.index), match:clean(m[1] || m[2] || m[3] || m[0]).slice(0, 180), snippet:getLine(content, m.index), source });
      }
    }
  }
  return out;
}

function extractFacts(files) {
  const patterns = [
    { kind:'firebase-config', label:'Firebase Config', re:/\b(projectId|databaseURL|authDomain|storageBucket)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi },
    { kind:'firebase-path', label:'Firebase ref()', re:/\bref\(\s*(?:db|database)\s*,\s*(["'`][^"'`]+["'`])/gi },
    { kind:'firebase-op', label:'Firebase read/write', re:/\b(set|update|push|onValue|get|remove)\s*\(\s*ref\([^\n;]{0,220}/gi },
    { kind:'function', label:'Funktion', re:/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g },
    { kind:'function', label:'Funktion', re:/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g },
    { kind:'function', label:'Window-Funktion', re:/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g },
    { kind:'ui', label:'Button', re:/<button[^>]*>([^<]{2,140})<\/button>/gi },
    { kind:'ui', label:'Placeholder', re:/placeholder=["'`]([^"'`]{2,140})["'`]/gi },
    { kind:'ui', label:'Title', re:/<title[^>]*>([^<]{2,140})<\/title>/gi },
    { kind:'ui', label:'Heading', re:/<h[1-4][^>]*>([^<]{2,140})<\/h[1-4]>/gi },
    { kind:'api', label:'Route/API', re:/\b(?:fetch|app\.(?:get|post|put|delete|patch))\s*\(\s*["'`]([^"'`]+)["'`]/g },
    { kind:'offer', label:'Angebot/Deal', re:/\b(angebot|angebote|angebots|offer|offers|deal|deals|preisvorschlag|ankauf|kaufangebot|verkaufsangebot|rabatt|discount)\b/gi },
    { kind:'queue', label:'Queue', re:/\b(queue|warteschlange|bestellnummer|currentOrder|nextOrder|orderInput|remainingOrders|orderQueue)\b/gi },
    { kind:'quizt', label:'Quizt', re:/\b(quizt|quiz|punkte|punktestand|runde|round|team|teams|liga|league|moderator|eventcode)\b/gi },
    { kind:'product', label:'Produkt/Bestand', re:/\b(produkt|produkte|product|products|bestand|stock|barcode|preis|price|inventory|cardmarket|flohmarkt|artikel)\b/gi },
    { kind:'bot', label:'Bot', re:/\b(telegram|bot|webhook|sendMessage|bot_token|discord)\b/gi },
    { kind:'watcher', label:'Watcher/Scraper', re:/\b(watcher|watchlist|scraper|playwright|chromium|headless|monitor|notify|notification)\b/gi },
    { kind:'devhub', label:'Developer Hub', re:/\b(github|repository|repo|deploy|rollback|scanner|developer hub|projektgedächtnis|secret|token)\b/gi }
  ];
  return collect(files, patterns, 260);
}

function factsByKind(facts, kind, onlyCode = true) { return facts.filter(f => f.kind === kind && (!onlyCode || f.source === 'code')); }
function countKind(facts, kind, onlyCode = true) { return factsByKind(facts, kind, onlyCode).length; }

function scoreDomains(repo, facts, codeJoined) {
  const repoName = String(repo.name || '').toLowerCase();
  const scores = { 'offer-tracking':0, 'queue-management':0, 'market-tools':0, scoreboard:0, 'stream-tools':0, bot:0, watcher:0, website:0, 'developer-tool':0 };
  const addFact = (domain, kind, weight) => { scores[domain] += countKind(facts, kind, true) * weight; scores[domain] += (countKind(facts, kind, false) - countKind(facts, kind, true)); };
  addFact('offer-tracking','offer',5);
  addFact('queue-management','queue',5);
  addFact('scoreboard','quizt',5);
  addFact('market-tools','product',3);
  addFact('bot','bot',6);
  addFact('watcher','watcher',6);
  addFact('developer-tool','devhub',4);
  if (/angebot|offer|deal/i.test(repoName)) scores['offer-tracking'] += 8;
  if (/queue/i.test(repoName)) scores['queue-management'] += 8;
  if (/quizt|score|liga/i.test(repoName)) scores.scoreboard += 8;
  if (/flohmarkt|bulk|cardmarket|product|inventory/i.test(repoName)) scores['market-tools'] += 6;
  if (/bot/i.test(repoName)) scores.bot += 8;
  if (/watcher|watchlist/i.test(repoName)) scores.watcher += 8;
  if (/developer|hub|projektgedaechtnis|projektgedächtnis/i.test(repoName)) scores['developer-tool'] += 10;
  for (const f of factsByKind(facts, 'function', true)) {
    const s = `${f.match} ${f.snippet}`.toLowerCase();
    if (/offer|angebot|deal/.test(s)) scores['offer-tracking'] += 6;
    if (/queue|order|bestell/.test(s)) scores['queue-management'] += 6;
    if (/score|team|round|runde|league|liga|quiz/.test(s)) scores.scoreboard += 6;
    if (/product|price|stock|inventory|barcode|produkt|preis|bestand/.test(s)) scores['market-tools'] += 5;
    if (/repo|scan|deploy|rollback|secret|github/.test(s)) scores['developer-tool'] += 5;
  }
  if (/overlay/i.test(codeJoined)) scores['stream-tools'] += 2;
  return scores;
}

function rankedDomains(scores) {
  const entries = Object.entries(scores).sort((a,b) => b[1] - a[1]);
  const top = entries[0]?.[1] || 0;
  return entries.filter(([_,s]) => s >= Math.max(5, top * 0.5)).map(([d]) => d);
}

function inferTech(paths, joined, facts, scores) {
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
  if (scores['offer-tracking'] >= 10) tech.push('Angebots-Tracking');
  if (scores['queue-management'] >= 10) tech.push('Queue-Verwaltung');
  if (scores.scoreboard >= 10) tech.push('Scoreboard');
  return uniq(tech);
}

function inferFirebase(facts, joined) {
  const projectIds = uniq(findAll(/projectId\s*[:=]\s*["'`]([^"'`]+)["'`]/g, joined));
  const dbUrls = uniq(findAll(/databaseURL\s*[:=]\s*["'`]([^"'`]+)["'`]/g, joined));
  const rawPaths = uniq(facts.filter(f => f.kind === 'firebase-path').map(f => f.match.replace(/^['"`]|['"`]$/g, '')));
  const paths = rawPaths.filter(p => !/^https?:/.test(p) && !p.includes('${'));
  const dynamicPaths = rawPaths.filter(p => p.includes('${'));
  const rulesMentioned = /database\.rules|\.read|\.write|firebase rules|rules_version/i.test(joined);
  return { detected: Boolean(projectIds.length || dbUrls.length || /firebase/i.test(joined)), projectIds, dbUrls, paths, dynamicPaths, rulesMentioned };
}

function inferProjectSpace(repo, txt, domains) {
  const name = `${repo.fullName} ${repo.name}`.toLowerCase();
  const lower = txt.toLowerCase();
  if (/quizt|quiz_mit_twist|streetlife|quizabend/.test(name + ' ' + lower) || domains.includes('scoreboard')) return { key:'quizt', name:'Quizt / Laura', type:'externes Projekt', owner:'Laura / Quizt', separation:'Nicht mit ChiefCards vermischen. Fabian entwickelt Technik, aber Quizt ist inhaltlich und organisatorisch ein eigenes Projekt.' };
  if (domains.includes('bot') || domains.includes('watcher') || /vps|server|gunicorn|systemd/.test(name + ' ' + lower)) return { key:'server', name:'Server / Bots', type:'Infrastruktur', owner:'Fabian', separation:'Servernahe Dienste getrennt von einzelnen Markenprojekten dokumentieren.' };
  if (/chiefcards|chief-bali|queue|stream|offer|angebot|flohmarkt|bulk|cardmarket|otakuya|jp-display|ofcs/.test(name + ' ' + lower) || domains.some(d => ['offer-tracking','queue-management','market-tools','stream-tools'].includes(d))) return { key:'chiefcards', name:'ChiefCards / Fabian', type:'eigenes Business', owner:'Fabian / ChiefCards', separation:'Gehört zu ChiefCards, Stream, Shop, Kartenhandel oder internen Tools.' };
  return { key:'unknown', name:'Unsortiert', type:'noch einordnen', owner:'unbekannt', separation:'Projektgruppe manuell prüfen.' };
}

function inferPurpose(repo, scores, domains, space, quality, conflicts) {
  const title = repo.name;
  const entries = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const top = entries[0]?.[0] || 'unknown';
  const topScore = entries[0]?.[1] || 0;
  const second = entries[1];
  const ambiguous = quality.confidence !== 'hoch' || conflicts.length || (second && topScore - second[1] < 8);
  if (ambiguous) return `${title}: Zweck nicht sicher bestimmt. Gelesene Code-Fakten prüfen. Top-Signal: ${top} (${topScore}), zweites Signal: ${second?.[0] || 'keins'} (${second?.[1] || 0}).`;
  if (space.key === 'quizt') return 'Quizt-Anwendung. Externes Projekt für Laura, nicht ChiefCards.';
  if (top === 'offer-tracking') return `${title}: Angebots-/Deal-Tool zur Verwaltung, Beobachtung oder Bewertung von Angeboten, Deals oder Preisvorschlägen.`;
  if (top === 'queue-management') return `${title}: Queue-/Warteschlangen-Tool zur Verwaltung von Bestellungen oder Reihenfolge.`;
  if (top === 'market-tools') return `${title}: Tool für Produkte, Preise, Bestände, Barcode/Inventar oder Verkaufsverwaltung.`;
  if (top === 'scoreboard') return `${title}: Scoreboard-, Punkte-, Team- oder Liga-Anwendung.`;
  if (top === 'bot') return `${title}: Bot-Anwendung mit Messaging/Webhook-Anbindung.`;
  if (top === 'watcher') return `${title}: Watcher/Scraper zur Beobachtung von Produkten, Webseiten oder Änderungen.`;
  if (top === 'developer-tool') return `${title}: Developer-Hub oder Verwaltungswerkzeug für Repositories, Deployments, Secrets oder Projektkontext.`;
  return `${title}: Zweck nicht sicher erkannt.`;
}

function inferArchitecture(paths, joined, repo, facts, scores) {
  const lower = joined.toLowerCase();
  const a = [];
  if (paths.length === 1 && paths.includes('index.html')) a.push('Ein-Datei-App: index.html enthält Oberfläche, Logik und Styles. Der Scanner hat diese Datei aus GitHub gelesen.');
  if (paths.includes('package.json') && paths.some(p => p.startsWith('server/'))) a.push('Node/Express-App mit Backend-Struktur.');
  if (paths.some(p => p.startsWith('public/'))) a.push('Frontend-Dateien liegen im public-Verzeichnis.');
  if (/firebasejs|gstatic\.com\/firebasejs/.test(lower)) a.push('Firebase wird clientseitig per CDN eingebunden.');
  if (/getdatabase|realtime|onvalue|ref\(/.test(lower)) a.push('Nutzt Firebase Realtime Database.');
  if (/urlsearchparams/.test(lower)) a.push('URL-Parameter steuern Modi oder Ansichten.');
  if (repo.hasPages) a.push('GitHub Pages ist laut Repository aktiv.');
  const funcs = factsByKind(facts, 'function', true).map(f=>f.match).filter(Boolean).slice(0,12);
  if (funcs.length) a.push(`Wichtige Funktionen erkannt: ${uniq(funcs).join(', ')}.`);
  const ui = factsByKind(facts, 'ui', true).map(f=>f.match).filter(Boolean).slice(0,12);
  if (ui.length) a.push(`UI-Texte/Buttons: ${uniq(ui).join(', ')}.`);
  const strongest = Object.entries(scores).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([d,s])=>`${d} (${s})`).join(', ');
  if (strongest) a.push(`Stärkste Code-Signale: ${strongest}.`);
  return a;
}

function inferDataModel(facts, joined) {
  const keys = uniq([
    ...findAll(/\b(?:state|data|config|settings)\.([A-Za-z_$][\w$]*)/g, joined),
    ...findAll(/\b([A-Za-z_$][\w$]*(?:Queue|Offer|Deal|Product|Item|Team|Round|League|Event|Score|Price|Stock|Order|Angebot|Preis|Bestand|Watchlist|Display|Card)[A-Za-z_$0-9]*)\b/g, joined),
    ...facts.filter(f=>['firebase-path','api'].includes(f.kind)).map(f=>f.match)
  ]).filter(x => !String(x).includes('${')).slice(0, 100);
  return keys;
}

function inferBots(joined, repo) {
  const botSignals = [];
  if (/telegram/i.test(joined + repo.name)) botSignals.push('Telegram im Code erwähnt');
  if (/webhook/i.test(joined)) botSignals.push('Webhook-Struktur erkannt');
  if (/systemd|\.service|gunicorn|pm2/i.test(joined)) botSignals.push('Server-Dienst-Struktur erkannt');
  if (/playwright|chromium|watcher|scraper/i.test(joined + repo.name)) botSignals.push('Watcher/Scraper-Struktur erkannt');
  return botSignals;
}

function inferOwnershipNotes(space) {
  if (space.key === 'quizt') return ['Quizt ist ein externes Projekt für Laura und gehört nicht zu ChiefCards.', 'Branding, Sprache, Socials und Geschäftslogik nicht mit ChiefCards, ChiefBaliman oder Kartenhandel vermischen.', 'Technische Infrastruktur darf gemeinsam genutzt werden, muss im Kontext aber als externe Abhängigkeit markiert werden.'];
  if (space.key === 'chiefcards') return ['Gehört zum ChiefCards/ChiefBaliman-Umfeld.', 'Kann mit Stream-, Shop-, Karten- und Flohmarkt-Tools zusammen betrachtet werden.'];
  if (space.key === 'server') return ['Serverdienst oder Bot. Vor Änderungen prüfen, ob systemd, Ports oder bestehende Dienste betroffen sind.', 'Nicht mit einem einzelnen Markenprojekt vermischen, wenn der Dienst mehrere Projekte unterstützt.'];
  return ['Projektgruppe noch nicht sicher erkannt. Vor größeren Änderungen manuell einordnen.'];
}

function inferConflicts(repo, scores, domains, space) {
  const c = [];
  const top = Object.entries(scores).sort((a,b)=>b[1]-a[1])[0]?.[0];
  if ((scores['offer-tracking'] || 0) >= 10 && (scores['queue-management'] || 0) >= 10) c.push('Sowohl Angebots-/Deal-Signale als auch Queue-Signale gefunden. Roh-Code-Fakten prüfen.');
  if (/angebot|offer|deal/i.test(repo.name) && top === 'queue-management') c.push('Repo-Name deutet auf Angebote hin, aber der gelesene Code enthält stärkere Queue-Signale. Möglich: falscher Code im Repo, altes Upload oder Scanner-Gewichtung falsch.');
  if (/queue/i.test(repo.name) && top === 'offer-tracking') c.push('Repo-Name deutet auf Queue hin, aber der gelesene Code enthält stärkere Angebots-Signale.');
  if (space.key === 'quizt' && scores['market-tools'] > scores.scoreboard) c.push('Quizt wurde erkannt, aber Code enthält starke Shop/Produkt-Signale. Projektgruppe prüfen.');
  return c;
}

function inferScanQuality(files, facts, scores, conflicts) {
  const html = files.filter(f => f.path.endsWith('.html')).length;
  const codeFiles = files.filter(f => /\.(html|js|mjs|cjs|ts|tsx|jsx|py)$/i.test(f.path)).length;
  const codeFacts = facts.filter(f => f.source === 'code').length;
  const top = Object.entries(scores).sort((a,b)=>b[1]-a[1])[0] || ['unknown',0];
  const second = Object.entries(scores).sort((a,b)=>b[1]-a[1])[1] || ['none',0];
  let confidence = 'niedrig';
  if (codeFacts >= 12 && top[1] >= 18 && top[1] - second[1] >= 8 && !conflicts.length) confidence = 'hoch';
  else if (codeFacts >= 6 && top[1] >= 8) confidence = 'mittel';
  return { filesRead: files.length, codeFiles, htmlFiles: html, extractedSignals: codeFacts, topDomain: top[0], topDomainScore: top[1], secondDomain: second[0], secondDomainScore: second[1], confidence, quality: confidence };
}

function buildCodeInsights(repo, facts, scores, domains, files) {
  const functions = uniq(factsByKind(facts, 'function', true).map(f => f.match)).slice(0,120);
  const uiLabels = uniq(factsByKind(facts, 'ui', true).map(f => f.match)).slice(0,120);
  const endpointUrls = uniq(factsByKind(facts, 'api', true).map(f => f.match)).slice(0,100);
  const stateKeys = uniq([...facts.filter(f=>['firebase-path','firebase-op','product','offer','queue','quizt'].includes(f.kind) && f.source==='code').map(f=>f.match)]).slice(0,120);
  const domainScores = scores;
  const evidence = Object.entries(scores).sort((a,b)=>b[1]-a[1]).filter(([_,s])=>s>0).map(([domain,score]) => ({ domain, score, examples:facts.filter(f=>matchDomain(domain, f)).slice(0,12).map(f=>`${f.file}:${f.line} ${f.match}`) }));
  const signature = uniq([
    ...domains.map(d => `domain:${d} (${scores[d]})`),
    ...functions.slice(0,14).map(f => `fn:${f}`),
    ...uiLabels.slice(0,12).map(l => `ui:${l}`),
    ...endpointUrls.slice(0,10).map(u => `route:${u}`)
  ]).slice(0,80);
  const fileSummaries = files.map(f => summarizeFile(f, facts)).filter(Boolean).slice(0,100);
  const topTerms = extractTopTerms(files.filter(f=>!/\.md$/i.test(f.path)).map(f=>f.content).join('\n'));
  const htmlInfo = { title: uiLabels.find(Boolean) || '' };
  const packageInfo = readPackage(files);
  return { domains, domainScores, topDomain:Object.entries(scores).sort((a,b)=>b[1]-a[1])[0]?.[0]||'unknown', topScore:Object.entries(scores).sort((a,b)=>b[1]-a[1])[0]?.[1]||0, functions, uiLabels, endpointUrls, stateKeys, storageKeys:[], signature, fileSummaries, packageInfo, htmlInfo, topTerms, evidence, codeFacts:facts.slice(0,220) };
}

function matchDomain(domain, f) {
  const map = {
    'offer-tracking':['offer'], 'queue-management':['queue'], scoreboard:['quizt'], 'market-tools':['product'], bot:['bot'], watcher:['watcher'], 'developer-tool':['devhub']
  };
  return (map[domain] || []).includes(f.kind);
}

function readPackage(files) {
  const f = files.find(x => x.path === 'package.json');
  if (!f) return {};
  try { const p = JSON.parse(f.content); return { name:p.name, description:p.description, scripts:p.scripts ? Object.keys(p.scripts) : [], dependencies:Object.keys({ ...(p.dependencies || {}), ...(p.devDependencies || {}) }).slice(0, 80) }; } catch { return {}; }
}

function extractTopTerms(text) {
  const stop = new Set('const let var function return await async true false null undefined class import export from href src div span button input value document window this that with eine einem einer der die das und oder for if else try catch then map filter reduce length push set get query selector inner html text content display style color background margin padding font data state config item items index event target click change submit type name class aria label title placeholder github chief baliman'.split(' '));
  const words = String(text || '').replace(/[A-Z]/g, m => ` ${m.toLowerCase()}`).toLowerCase().match(/[a-zäöüß][a-zäöüß0-9_-]{3,}/g) || [];
  const counts = new Map();
  for (const w of words) { const k = w.replace(/[-_]/g, ''); if (!stop.has(k) && !/^\d+$/.test(k)) counts.set(k, (counts.get(k)||0)+1); }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 40).map(([term,count]) => ({ term, count }));
}

function summarizeFile(f, facts) {
  const own = facts.filter(x => x.file === f.path && x.source === 'code');
  const kinds = uniq(own.map(x => x.kind)).slice(0,8);
  if (!kinds.length) return null;
  return `${f.path}: ${kinds.join(', ')} (${own.length} Treffer)`;
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

function buildGuardrails(space, firebase, repo, insights, conflicts) {
  const base = ['Bestehende Funktionen erhalten und Änderungen gezielt einbauen.', 'Secrets, Tokens, Private Keys und Passwörter nicht in ZIPs, Code oder Chat-Ausgaben übernehmen.', 'ZIP-Deploy überschreibt nur Pfade aus der ZIP. Nicht enthaltene Repo-Dateien bleiben bestehen.', 'Vor Änderungen die Roh-Code-Fakten prüfen und Zweck nicht aus anderen Projekten übernehmen.'];
  if (conflicts.length) base.unshift('Scanner hat widersprüchliche Signale gefunden. Vor Änderungen Zweck und richtige Dateien prüfen.');
  if (firebase.detected) base.push('Firebase Rules und Datenbankstruktur nie ohne Gesamtstand vollständig ersetzen. Änderungen immer integrieren.');
  if (repo.hasPages) base.push('Bei GitHub-Pages-Projekten relative Pfade und statisches Hosting beachten.');
  if (space.key === 'quizt') base.unshift('Quizt ist extern für Laura. Nicht mit ChiefCards, ChiefBaliman, Shop, Kartenhandel oder Stream-Branding vermischen.');
  if (insights.topDomain === 'offer-tracking') base.push('Dieses Projekt ist Angebots-/Deal-Tracking. Nicht als Queue-Tracker oder Bestellwarteschlange behandeln.');
  if (insights.topDomain === 'queue-management') base.push('Dieses Projekt verwaltet eine Queue/Warteschlange. Reihenfolge, aktuelle Bestellung und Overlay-Modus erhalten.');
  return base;
}

function buildWiki(x) {
  const evidence = x.codeInsights.evidence.length ? x.codeInsights.evidence.map(e => `- ${e.domain}: Score ${e.score}${e.examples.length ? `\n  - ${e.examples.join('\n  - ')}` : ''}`).join('\n') : '- Keine belastbaren Belege erkannt';
  const facts = x.codeInsights.codeFacts?.length ? x.codeInsights.codeFacts.slice(0,120).map(f => `- ${f.kind} | ${f.file}:${f.line} | ${f.match} | ${f.snippet}`).join('\n') : '- Keine Roh-Code-Fakten erkannt';
  const terms = x.codeInsights.topTerms.length ? x.codeInsights.topTerms.slice(0,25).map(t => `- ${t.term}: ${t.count}`).join('\n') : '- Keine Begriffe ermittelt';
  return `# ${x.repo.fullName}\n\n## Projektgruppe\n- Bereich: ${x.projectSpace.name}\n- Typ: ${x.projectSpace.type}\n- Verantwortlich: ${x.projectSpace.owner}\n- Trennung: ${x.projectSpace.separation}\n\n## Zweck\n${x.purpose}\n\n## Scan-Qualität\n- Gelesene Dateien: ${x.scanQuality.filesRead}\n- Code-Dateien: ${x.scanQuality.codeFiles}\n- HTML-Dateien: ${x.scanQuality.htmlFiles}\n- Erkannte Code-Signale: ${x.scanQuality.extractedSignals}\n- Top-Domäne: ${x.scanQuality.topDomain}\n- Top-Score: ${x.scanQuality.topDomainScore}\n- Zweite Domäne: ${x.scanQuality.secondDomain}\n- Zweiter Score: ${x.scanQuality.secondDomainScore}\n- Konfidenz: ${x.scanQuality.confidence}\n\n## Roh-Code-Fakten mit Datei und Zeile\n${facts}\n\n## Belege für Erkennung\n${evidence}\n\n## Konflikte / Prüfpunkte\n${x.conflicts.length ? x.conflicts.map(c => `- ${c}`).join('\n') : '- Keine Konflikte erkannt'}\n\n## Häufige Code-Begriffe\n${terms}\n\n## Besitz- und Kontextregeln\n${x.ownershipNotes.map(n => `- ${n}`).join('\n')}\n\n## Technik\n${x.tech.length ? x.tech.map(t => `- ${t}`).join('\n') : '- Nicht eindeutig erkannt'}\n\n## Hosting\n${x.repo.hasPages ? `- GitHub Pages: https://${x.repo.fullName.split('/')[0]}.github.io/${x.repo.name}/` : '- Kein GitHub Pages erkannt'}\n\n## Firebase\n${x.firebase.projectIds.length ? x.firebase.projectIds.map(p => `- Projekt-ID: ${p}`).join('\n') : '- Keine Projekt-ID erkannt'}\n${x.firebase.dbUrls.length ? x.firebase.dbUrls.map(u => `- Database URL: ${u}`).join('\n') : ''}\n${x.firebase.paths.length ? x.firebase.paths.map(p => `- Datenpfad: ${p}`).join('\n') : ''}\n${x.firebase.dynamicPaths?.length ? x.firebase.dynamicPaths.map(p => `- Dynamischer Datenpfad: ${p}`).join('\n') : ''}\n${x.sharedFirebase.length ? `\nGeteilte Firebase-Ressourcen:\n${x.sharedFirebase.map(p => `- ${p.fullName} (${p.space})`).join('\n')}` : ''}\n\n## Architektur\n${x.architecture.length ? x.architecture.map(a => `- ${a}`).join('\n') : '- Keine sichere Architektur-Zusammenfassung möglich'}\n\n## Erkannte Funktionen\n${x.codeInsights.functions.length ? x.codeInsights.functions.slice(0, 80).map(k => `- ${k}`).join('\n') : '- Keine Funktionen erkannt'}\n\n## Erkannte UI-Texte\n${x.codeInsights.uiLabels.length ? x.codeInsights.uiLabels.slice(0, 80).map(k => `- ${k}`).join('\n') : '- Keine UI-Texte erkannt'}\n\n## Erkannte Datenmodelle / Schlüssel\n${x.dataModel.length ? x.dataModel.map(k => `- ${k}`).join('\n') : '- Keine klaren Datenmodelle erkannt'}\n\n## Erkannte Routen / API-Pfade\n${x.routes.length ? x.routes.map(r => `- ${r}`).join('\n') : '- Keine Routen erkannt'}\n\n## Datei-Zusammenfassung\n${x.codeInsights.fileSummaries.length ? x.codeInsights.fileSummaries.map(f => `- ${f}`).join('\n') : '- Keine Datei-Zusammenfassung möglich'}\n\n## Wichtige Dateien\n${x.importantFiles.length ? x.importantFiles.map(f => `- ${f}`).join('\n') : '- Keine wichtigen Dateien erkannt'}\n\n## Risiken\n${x.secrets.length ? x.secrets.map(s => `- ${s}`).join('\n') : '- Keine kritischen Secrets erkannt'}\n${x.todos.length ? `\n## TODOs\n${x.todos.map(t => `- ${t}`).join('\n')}` : ''}\n\n## Änderungsregeln\n- Bestehende Funktionen erhalten.\n- Projektgruppe beachten und fremde Marken-/Business-Kontexte nicht vermischen.\n- Erst Roh-Code-Fakten prüfen. Bei Konflikten nicht raten.\n- Firebase-Strukturen nicht blind ersetzen.\n- Secrets niemals in ChatGPT-Prompts oder ZIP-Dateien übernehmen.\n`;
}
