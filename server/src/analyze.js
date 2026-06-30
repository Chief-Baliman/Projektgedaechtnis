import crypto from 'crypto';

const TEXT_EXT = /\.(html|js|ts|tsx|jsx|json|md|css|yml|yaml|env|txt|rules|cjs|mjs|py|service|toml|ini|conf|vue|svelte)$/i;
const MAX_FILES = 700;
const MAX_FILE_SIZE = 1200000;

const uniq = arr => [...new Set((arr || []).filter(Boolean))];
const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const sha = s => crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 12);

export function shouldReadFile(item) {
  return item.type === 'blob'
    && TEXT_EXT.test(item.path)
    && (item.size || 0) <= MAX_FILE_SIZE
    && !/node_modules|dist|build|vendor|\.min\.js|package-lock\.json|pnpm-lock|yarn\.lock|\.map$/i.test(item.path);
}

export function limitReadable(tree) {
  return tree.filter(shouldReadFile).sort((a,b) => scorePath(a.path) - scorePath(b.path)).slice(0, MAX_FILES);
}

function scorePath(p) {
  if (/^(README\.md|index\.html|package\.json|firebase\.json|database\.rules\.json|firestore\.rules|\.env\.example)$/i.test(p)) return 0;
  if (/^(src|server|app|pages|components|lib|scripts|functions|public)\//i.test(p)) return 1;
  if (/firebase|database|rules|config|main|app|index|vite|next|nuxt|requirements|\.service|docker|nginx|bot|watcher|tracker/i.test(p)) return 2;
  return 5;
}

export function analyzeRepository(repo, files, allKnownProjects = []) {
  const safeFiles = (files || []).map(f => ({ ...f, content: String(f.content || '') }));
  const paths = safeFiles.map(f => f.path);
  const codeFiles = safeFiles.filter(f => !/\.md$/i.test(f.path));
  const facts = extractFacts(safeFiles);
  const sourceAudit = buildSourceAudit(repo, safeFiles, facts);
  const scores = scoreDomains(repo, facts);
  const domains = rankedDomains(scores);
  const conflicts = inferConflicts(repo, scores, facts, domains);
  const firebase = inferFirebase(facts);
  const tech = inferTech(paths, facts, repo);
  const projectSpace = inferProjectSpace(repo, facts, domains);
  const ownershipNotes = inferOwnershipNotes(projectSpace);
  const scanQuality = inferScanQuality(safeFiles, facts, scores, conflicts);
  const purpose = inferPurpose(repo, domains, scores, facts, conflicts, scanQuality);
  const architecture = inferArchitecture(paths, facts, firebase, repo);
  const dataModel = inferDataModel(facts);
  const routes = uniq(facts.filter(f => f.kind === 'api').map(f => f.match)).slice(0, 80);
  const bots = inferBots(facts);
  const importantFiles = inferImportantFiles(paths);
  const todos = facts.filter(f => f.kind === 'todo').map(f => `${f.file}:${f.line} ${f.match}`).slice(0, 50);
  const secrets = detectSecrets(safeFiles);
  const sharedFirebase = allKnownProjects
    .filter(p => p.fullName !== repo.fullName && (p.analysis?.firebase?.projectIds || []).some(id => firebase.projectIds.includes(id)))
    .map(p => ({ fullName:p.fullName, space:p.analysis?.projectSpace?.name || 'Unbekannt' }));
  const relatedProjects = allKnownProjects.filter(p => p.fullName !== repo.fullName).map(p => {
    const sameFirebase = (p.analysis?.firebase?.projectIds || []).some(id => firebase.projectIds.includes(id));
    const sameSpace = p.analysis?.projectSpace?.key && p.analysis.projectSpace.key === projectSpace.key;
    return sameFirebase || sameSpace ? { fullName:p.fullName, reason:sameFirebase?'teilt Firebase-Ressource':'gleiche Projektgruppe', space:p.analysis?.projectSpace?.name || 'Unbekannt', hardDependency:sameFirebase } : null;
  }).filter(Boolean);
  const codeInsights = buildCodeInsights(repo, facts, scores, domains, safeFiles, sourceAudit);
  const health = [
    { label:'Code wirklich gelesen', status: sourceAudit.filesWithContent > 0 ? 'ok' : 'danger' },
    { label:'README vorhanden', status: paths.some(p => /^README\.md$/i.test(p)) ? 'ok' : 'warn' },
    { label:'GitHub Pages', status: repo.hasPages ? 'ok' : 'neutral' },
    { label:'Firebase erkannt', status: firebase.detected ? 'ok' : 'neutral' },
    { label:'Kritische Secrets im Code', status: secrets.length ? 'danger' : 'ok' },
    { label:'TODOs gefunden', status: todos.length ? 'warn' : 'ok' },
    { label:'Scan-Konfidenz', status: scanQuality.confidence === 'hoch' ? 'ok' : scanQuality.confidence === 'mittel' ? 'warn' : 'danger' },
    { label:'Konflikte', status: conflicts.length ? 'warn' : 'ok' }
  ];
  const wiki = buildWiki({ repo, purpose, tech, firebase:{...firebase, sharedWith:sharedFirebase}, bots, projectSpace, ownershipNotes, importantFiles, architecture, secrets, sharedFirebase, dataModel, routes, todos, codeInsights, scanQuality, conflicts, sourceAudit });
  return {
    repoName: repo.name, fullName: repo.fullName, purpose, defaultBranch: repo.defaultBranch, htmlUrl: repo.htmlUrl,
    pagesUrl: repo.hasPages ? `https://${repo.fullName.split('/')[0]}.github.io/${repo.name}/` : '', updatedAt: repo.updatedAt,
    fileCount: paths.length, scannedFiles: safeFiles.length, sourceAudit, tech, projectSpace, ownershipNotes,
    firebase: { ...firebase, sharedWith: sharedFirebase }, bots, routes, dataModel, codeInsights, scanQuality,
    conflicts, relatedProjects, hosting: repo.hasPages ? ['GitHub Pages aktiv'] : [], importantFiles,
    architecture, secretWarnings: secrets, todos, health, wiki, scannedAt: new Date().toISOString(),
    guardrails: buildGuardrails(projectSpace, firebase, repo, codeInsights, conflicts)
  };
}

function lineNoAt(text, index) { return String(text || '').slice(0, index).split(/\r?\n/).length; }
function getLine(text, index) { const lines = String(text || '').split(/\r?\n/); return clean(lines[Math.max(0, lineNoAt(text, index) - 1)] || '').slice(0, 260); }
function sourceOf(path) { return /(^|\/)README\.md$/i.test(path) || /\.md$/i.test(path) ? 'readme' : 'code'; }
function evidenceWeight(f) {
  if (f.source !== 'code') return 0.25;
  if (/^(package\.json|.*\.css|.*\.md)$/i.test(f.file)) return 0.45;
  if (/^(src|server|app|pages|components|lib|public|scripts)\//i.test(f.file) || /index\.html$/i.test(f.file)) return 1;
  return 0.75;
}
function collect(files, patterns, limit = 700) {
  const out = [];
  for (const f of files || []) {
    const content = String(f.content || '');
    const src = sourceOf(f.path);
    for (const item of patterns) {
      const re = new RegExp(item.re.source, item.re.flags.includes('g') ? item.re.flags : item.re.flags + 'g');
      let m;
      while ((m = re.exec(content)) && out.length < limit) {
        const match = clean(m[1] || m[2] || m[3] || m[0]).slice(0, 220);
        const fact = { kind:item.kind, label:item.label, file:f.path, line:lineNoAt(content, m.index), match, snippet:getLine(content, m.index), source:src };
        fact.weight = evidenceWeight(fact);
        out.push(fact);
      }
    }
  }
  return out;
}

function extractFacts(files) {
  const patterns = [
    { kind:'firebase-config', label:'Firebase projectId', re:/\bprojectId\s*[:=]\s*["'`]([^"'`]+)["'`]/gi },
    { kind:'firebase-dburl', label:'Firebase databaseURL', re:/\bdatabaseURL\s*[:=]\s*["'`]([^"'`]+)["'`]/gi },
    { kind:'firebase-config', label:'Firebase authDomain', re:/\bauthDomain\s*[:=]\s*["'`]([^"'`]+)["'`]/gi },
    { kind:'firebase-import', label:'Firebase Import', re:/\bfrom\s+["'`]https:\/\/www\.gstatic\.com\/firebasejs\/[^"'`]+["'`]/gi },
    { kind:'firebase-ref-static', label:'Firebase ref statisch', re:/\bref\(\s*(?:db|database)\s*,\s*["'`]([^"'`]+)["'`]\s*\)/gi },
    { kind:'firebase-ref-dynamic', label:'Firebase ref dynamisch', re:/\bref\(\s*(?:db|database)\s*,\s*(`[^`]+`|[A-Za-z_$][\w$]*(?:\[[^\]]+\])?(?:\s*\+\s*[^),]+)?)\s*\)/gi },
    { kind:'firebase-op', label:'Firebase Operation', re:/\b(set|update|push|onValue|get|remove)\s*\(/gi },
    { kind:'function', label:'Function Declaration', re:/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g },
    { kind:'function', label:'Arrow/Const Function', re:/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g },
    { kind:'function', label:'Window Function', re:/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g },
    { kind:'state-key', label:'Object Key', re:/\b([A-Za-z_$][\w$]{2,40})\s*:/g },
    { kind:'ui', label:'Button', re:/<button[^>]*>([^<]{2,160})<\/button>/gi },
    { kind:'ui', label:'Placeholder', re:/placeholder=["'`]([^"'`]{2,160})["'`]/gi },
    { kind:'ui', label:'Title', re:/<title[^>]*>([^<]{2,160})<\/title>/gi },
    { kind:'ui', label:'Heading', re:/<h[1-4][^>]*>([^<]{2,160})<\/h[1-4]>/gi },
    { kind:'api', label:'API Route', re:/\b(?:fetch|app\.(?:get|post|put|delete|patch))\s*\(\s*["'`]([^"'`]+)["'`]/g },
    { kind:'offer', label:'Angebot/Deal', re:/\b(angebot|angebote|angebots|offer|offers|deal|deals|preisvorschlag|ankauf|kaufangebot|verkaufsangebot|rabatt|discount)\b/gi },
    { kind:'queue', label:'Queue', re:/\b(queue|warteschlange|bestellnummer|currentOrder|nextOrder|orderInput|remainingOrders|orderQueue)\b/gi },
    { kind:'quizt', label:'Quizt', re:/\b(quizt|quiz|punkte|punktestand|runde|round|team|teams|liga|league|moderator|eventcode)\b/gi },
    { kind:'product', label:'Produkt/Bestand', re:/\b(produkt|produkte|product|products|bestand|stock|barcode|preis|price|inventory|cardmarket|flohmarkt|artikel|sku)\b/gi },
    { kind:'bot', label:'Bot', re:/\b(telegram|bot|webhook|sendMessage|bot_token|discord)\b/gi },
    { kind:'watcher', label:'Watcher/Scraper', re:/\b(watcher|watchlist|scraper|playwright|chromium|headless|monitor|notify|notification)\b/gi },
    { kind:'devhub', label:'Developer Hub', re:/\b(github|repository|repo|deploy|rollback|scanner|developer hub|projektgedächtnis|secret|token)\b/gi },
    { kind:'todo', label:'TODO', re:/\b(?:TODO|FIXME|HACK)\b[:\s-]*(.{0,180})/gi }
  ];
  return collect(files, patterns, 900);
}

function buildSourceAudit(repo, files, facts) {
  const rows = files.map(f => {
    const content = String(f.content || '');
    const fileFacts = facts.filter(x => x.file === f.path && x.source === 'code');
    return {
      path:f.path,
      bytes:Buffer.byteLength(content, 'utf8'),
      lines:content ? content.split(/\r?\n/).length : 0,
      sha1:sha(content),
      factCount:fileFacts.length,
      firstLine:clean(content.split(/\r?\n/).find(x => clean(x)) || '').slice(0, 160)
    };
  });
  const codeRows = rows.filter(r => !/\.md$/i.test(r.path));
  return {
    repo: repo.fullName,
    filesRequested: files.length,
    filesWithContent: rows.filter(r => r.bytes > 0).length,
    codeFilesWithContent: codeRows.filter(r => r.bytes > 0).length,
    totalBytes: rows.reduce((a,b)=>a+b.bytes,0),
    contentFingerprint: sha(rows.map(r => `${r.path}:${r.sha1}:${r.bytes}`).join('|')),
    topFiles: rows.sort((a,b) => b.factCount - a.factCount || b.bytes - a.bytes).slice(0, 40)
  };
}

function sumKind(facts, kind) { return facts.filter(f => f.kind === kind).reduce((a,f)=>a + (f.weight || 0), 0); }
function scoreDomains(repo, facts) {
  const repoName = String(repo.name || '').toLowerCase();
  const s = { 'offer-tracking':0, 'queue-management':0, 'market-tools':0, scoreboard:0, 'stream-tools':0, bot:0, watcher:0, website:0, 'developer-tool':0 };
  s['offer-tracking'] += sumKind(facts, 'offer') * 5;
  s['queue-management'] += sumKind(facts, 'queue') * 5;
  s.scoreboard += sumKind(facts, 'quizt') * 5;
  s['market-tools'] += sumKind(facts, 'product') * 3;
  s.bot += sumKind(facts, 'bot') * 6;
  s.watcher += sumKind(facts, 'watcher') * 6;
  s['developer-tool'] += sumKind(facts, 'devhub') * 4;
  // Repo-Name zählt nur als schwaches Zusatzsignal. Code muss entscheiden.
  if (/angebot|offer|deal/i.test(repoName)) s['offer-tracking'] += 3;
  if (/queue/i.test(repoName)) s['queue-management'] += 3;
  if (/quizt|score|liga/i.test(repoName)) s.scoreboard += 3;
  if (/flohmarkt|bulk|cardmarket|product|inventory/i.test(repoName)) s['market-tools'] += 2;
  if (/bot/i.test(repoName)) s.bot += 3;
  if (/watcher|watchlist|scraper/i.test(repoName)) s.watcher += 3;
  if (/website|site|page|landing/i.test(repoName)) s.website += 2;
  return Object.fromEntries(Object.entries(s).map(([k,v]) => [k, Math.round(v * 10) / 10]));
}
function rankedDomains(scores) { return Object.entries(scores).sort((a,b)=>b[1]-a[1]).filter(([,v])=>v>0).map(([key,score])=>({ key, score })); }
function evidenceFor(facts, kind, n = 8) { return facts.filter(f => f.kind === kind).sort((a,b)=>(b.weight||0)-(a.weight||0)).slice(0,n); }
function inferConflicts(repo, scores, facts, domains) {
  const out = [];
  const name = String(repo.name || '').toLowerCase();
  const top = domains[0]; const second = domains[1];
  const nameHints = [];
  if (/angebot|offer|deal/i.test(name)) nameHints.push('offer-tracking');
  if (/queue/i.test(name)) nameHints.push('queue-management');
  if (/quizt|score|liga/i.test(name)) nameHints.push('scoreboard');
  if (/flohmarkt|product|bulk|cardmarket/i.test(name)) nameHints.push('market-tools');
  if (top && nameHints.length && !nameHints.includes(top.key) && top.score >= 10) out.push(`Repository-Name deutet auf ${nameHints.join(', ')} hin, Code-Signale sprechen stärker für ${top.key}.`);
  if (top && second && top.score - second.score < 6 && second.score > 8) out.push(`Keine eindeutige Domäne: ${top.key} (${top.score}) und ${second.key} (${second.score}) liegen nah beieinander.`);
  const ids = inferFirebase(facts).projectIds;
  for (const id of ids) {
    if (/queue/i.test(id) && /angebot|offer|deal/i.test(name)) out.push(`Firebase projectId ${id} passt eher zu Queue als zum Repository-Namen.`);
    if (/quiz/i.test(id) && !/quiz/i.test(name)) out.push(`Firebase projectId ${id} wirkt wie Quizt/Quiz, Repository-Name nicht.`);
  }
  return out;
}
function inferPurpose(repo, domains, scores, facts, conflicts, scanQuality) {
  if (scanQuality.confidence === 'niedrig') return 'Aus dem gelesenen Code noch nicht sicher erkennbar. Bitte Scanner-Debug prüfen.';
  const top = domains[0];
  const second = domains[1];
  if (!top || top.score < 8) return 'Aus dem gelesenen Code nicht sicher genug erkannt.';
  if (second && top.score - second.score < 5 && second.score >= 8) return `Gemischtes Projekt oder unklare Analyse. Stärkste Signale: ${top.key} und ${second.key}.`;
  const labels = {
    'offer-tracking':'Angebots-, Deal- oder Preis-Tracker. Der Zweck wurde aus Angebots-/Deal-Signalen im Code abgeleitet.',
    'queue-management':'Queue-/Warteschlangen-Tool. Der Zweck wurde aus Queue- und Bestellnummer-Signalen im Code abgeleitet.',
    scoreboard:'Quizt-/Scoreboard-/Liga-Tool. Der Zweck wurde aus Punkte-, Runden-, Team- oder Liga-Signalen im Code abgeleitet.',
    'market-tools':'Produkt-, Bestands- oder Marktverwaltungs-Tool. Der Zweck wurde aus Produkt-, Preis-, Bestand- oder Cardmarket-Signalen im Code abgeleitet.',
    bot:'Bot- oder Messaging-Dienst. Der Zweck wurde aus Bot-, Telegram-, Webhook- oder Discord-Signalen im Code abgeleitet.',
    watcher:'Watcher-, Scraper- oder Monitoring-Dienst. Der Zweck wurde aus Watcher-, Scraper-, Playwright- oder Notification-Signalen im Code abgeleitet.',
    'developer-tool':'Developer-Hub oder internes Entwicklungstool. Der Zweck wurde aus GitHub-, Deploy-, Scanner- oder Secret-Signalen im Code abgeleitet.',
    website:'Statische Website oder Landingpage.'
  };
  return labels[top.key] || `Stärkste erkannte Code-Domäne: ${top.key}.`;
}
function inferFirebase(facts) {
  const ids = uniq(facts.filter(f => f.kind === 'firebase-config' && /projectId/i.test(f.snippet)).map(f => f.match));
  const dbUrls = uniq(facts.filter(f => f.kind === 'firebase-dburl').map(f => f.match));
  const staticPaths = uniq(facts.filter(f => f.kind === 'firebase-ref-static').map(f => f.match).filter(x => !/[${}`+\[\]]/.test(x))).slice(0,80);
  const dynamicPaths = uniq(facts.filter(f => f.kind === 'firebase-ref-dynamic').map(f => f.match)).slice(0,80);
  return { detected: ids.length || dbUrls.length || facts.some(f=>/^firebase/.test(f.kind)), projectIds: ids, dbUrls, paths: staticPaths, dynamicPaths, rulesMentioned: facts.some(f => /rules|database\.rules/i.test(f.file + ' ' + f.snippet)) };
}
function inferTech(paths, facts, repo) {
  const tech = [];
  if (paths.some(p=>/\.html$/i.test(p))) tech.push('HTML');
  if (paths.some(p=>/\.(js|mjs|cjs)$/i.test(p))) tech.push('JavaScript');
  if (paths.some(p=>/\.(ts|tsx)$/i.test(p))) tech.push('TypeScript');
  if (paths.some(p=>/\.py$/i.test(p))) tech.push('Python');
  if (paths.some(p=>/package\.json$/i.test(p))) tech.push('Node/npm');
  if (facts.some(f=>/^firebase/.test(f.kind))) tech.push('Firebase');
  if (facts.some(f=>f.kind==='api' && /app\.(get|post|put|delete|patch)/.test(f.snippet))) tech.push('Express/API');
  if (facts.some(f=>f.kind==='watcher')) tech.push('Watcher/Scraper');
  if (repo.hasPages) tech.push('GitHub Pages');
  return uniq(tech);
}
function inferProjectSpace(repo, facts, domains) {
  const text = `${repo.name} ${repo.fullName}`.toLowerCase();
  const top = domains[0]?.key;
  if (/quizt|quiz/i.test(text) || top === 'scoreboard') return { key:'quizt', name:'Quizt / Laura', type:'externes Projekt', owner:'Laura / Quizt', separation:'Nicht mit ChiefCards vermischen. Fabian entwickelt Technik, aber Quizt ist inhaltlich und organisatorisch ein eigenes Projekt.' };
  if (top === 'bot' || top === 'watcher' || /watcher|bot|server|vps/i.test(text)) return { key:'server', name:'Server / Bots', type:'Infrastruktur', owner:'Fabian', separation:'Servernahe Dienste getrennt von einzelnen Markenprojekten dokumentieren.' };
  if (/chief|card|queue|offer|angebot|flohmarkt|bulk|shop|stream/i.test(text) || ['queue-management','offer-tracking','market-tools'].includes(top)) return { key:'chiefcards', name:'ChiefCards / Fabian', type:'eigenes Business', owner:'Fabian / ChiefCards', separation:'Gehört zu ChiefCards, Stream, Shop, Kartenhandel oder internen Tools.' };
  return { key:'unknown', name:'Unsortiert', type:'noch einordnen', owner:'unbekannt', separation:'Projektgruppe manuell prüfen.' };
}
function inferOwnershipNotes(space) {
  if (space.key === 'quizt') return ['Quizt nicht als ChiefCards-Projekt behandeln.', 'Kontext, Branding, Texte und Daten getrennt von ChiefCards halten.', 'Änderungen an geteilten Ressourcen nur mit Hinweis auf andere Projekte.'];
  if (space.key === 'chiefcards') return ['ChiefCards-, Stream-, Shop- und Kartenhandels-Kontext darf verwendet werden.', 'Quizt-Kontext nur einbeziehen, wenn eine technische Ressource wirklich geteilt wird.'];
  if (space.key === 'server') return ['Serverdienste separat dokumentieren.', 'Bestehende systemd-Services nicht ohne Prüfung ändern oder neustarten.'];
  return ['Projektgruppe beim ersten Review manuell prüfen.'];
}
function inferScanQuality(files, facts, scores, conflicts) {
  const codeFacts = facts.filter(f => f.source === 'code');
  const domains = rankedDomains(scores);
  const top = domains[0]; const second = domains[1];
  let confidence = 'niedrig';
  if (codeFacts.length >= 12 && top?.score >= 15 && (!second || top.score - second.score >= 8) && conflicts.length === 0) confidence = 'hoch';
  else if (codeFacts.length >= 6 && top?.score >= 8) confidence = 'mittel';
  return { confidence, quality:confidence, extractedSignals:codeFacts.length, totalSignals:facts.length, filesRead:files.length, topDomain:top?.key || '', topDomainScore:top?.score || 0, secondDomain:second?.key || '', secondDomainScore:second?.score || 0 };
}
function inferArchitecture(paths, facts, firebase, repo) {
  const out = [];
  if (paths.length === 1 && /index\.html/i.test(paths[0])) out.push('Ein-Datei-App: index.html enthält vermutlich Oberfläche, Logik und Styles.');
  if (paths.some(p=>/^src\//i.test(p))) out.push('Quellcode liegt in src/.');
  if (paths.some(p=>/^server\//i.test(p))) out.push('Backend/Server-Code liegt in server/.');
  if (paths.some(p=>/^public\//i.test(p))) out.push('Statische Assets liegen in public/.');
  if (firebase.detected) out.push('Firebase wird im Code erkannt.');
  if (firebase.paths?.length) out.push(`Feste Firebase-Pfade erkannt: ${firebase.paths.slice(0,8).join(', ')}.`);
  if (firebase.dynamicPaths?.length) out.push('Es gibt dynamische Firebase-Pfade. Diese müssen im Code manuell geprüft werden.');
  if (facts.some(f=>f.kind==='firebase-op' && /onValue/.test(f.match))) out.push('Realtime-Updates über onValue() erkannt.');
  if (repo.hasPages) out.push('GitHub Pages ist laut Repository aktiv.');
  return uniq(out);
}
function inferDataModel(facts) {
  const staticRefs = facts.filter(f => f.kind === 'firebase-ref-static').map(f => f.match);
  const keys = facts.filter(f => f.kind === 'state-key').map(f => f.match).filter(x => !/^(style|class|id|type|href|src|onclick|async|await|return|const|let|var)$/i.test(x));
  return uniq([...staticRefs, ...keys]).slice(0, 120);
}
function inferBots(facts) {
  return uniq(facts.filter(f => f.kind === 'bot').map(f => f.match)).slice(0,30);
}
function inferImportantFiles(paths) {
  return paths.filter(p => /^(index\.html|package\.json|firebase\.json|database\.rules\.json|README\.md|\.env\.example|\.github\/workflows|server|src\/|app\.py|main\.py|requirements\.txt|vite\.config|tailwind|nginx|docker|Dockerfile|public\/app\.js)/i.test(p)).slice(0, 160);
}
function buildCodeInsights(repo, facts, scores, domains, files, audit) {
  const functions = uniq(facts.filter(f=>f.kind==='function' && f.source==='code').map(f=>f.match)).slice(0,80);
  const uiLabels = uniq(facts.filter(f=>f.kind==='ui' && f.source==='code').map(f=>f.match)).slice(0,80);
  const codeFacts = facts.filter(f=>f.source==='code').sort((a,b)=>(b.weight||0)-(a.weight||0)).slice(0,160);
  const fileSummaries = audit.topFiles.slice(0,30).map(f => `${f.path}: ${f.lines} Zeilen, ${f.bytes} Bytes, ${f.factCount} Scanner-Fakten, Hash ${f.sha1}`);
  return {
    domains: domains.slice(0,6).map(d=>`${d.key}:${d.score}`),
    signature: uniq([...functions.slice(0,20), ...uiLabels.slice(0,20), ...facts.filter(f=>/^firebase/.test(f.kind)).map(f=>f.match).slice(0,20)]),
    functions, uiLabels, fileSummaries, codeFacts,
    evidence: {
      offer:evidenceFor(facts,'offer'), queue:evidenceFor(facts,'queue'), quizt:evidenceFor(facts,'quizt'), product:evidenceFor(facts,'product'), bot:evidenceFor(facts,'bot'), watcher:evidenceFor(facts,'watcher'), firebase:facts.filter(f=>/^firebase/.test(f.kind)).slice(0,20)
    },
    rawInventory:audit.topFiles
  };
}
function detectSecrets(files) {
  const out = [];
  const patterns = [
    { name:'Private Key', re:/-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i },
    { name:'GitHub Token', re:/gh[pousr]_[A-Za-z0-9_]{30,}/ },
    { name:'Telegram Bot Token', re:/\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/ },
    { name:'Generic Secret Assignment', re:/\b(?:password|secret|token|api[_-]?key)\s*[:=]\s*["'`][^"'`]{16,}["'`]/i }
  ];
  for (const f of files) {
    if (/\.env\.example$/i.test(f.path)) continue;
    for (const p of patterns) if (p.re.test(f.content || '')) out.push(`${p.name}: ${f.path}`);
  }
  return uniq(out).slice(0,40);
}
function buildGuardrails(space, firebase, repo, insights, conflicts) {
  const rules = ['Bestehende Funktionen erhalten und Änderungen nicht blind auf andere Projekte übertragen.', 'Secrets, Tokens, Private Keys und Passwörter nicht in ZIPs oder Chat-Ausgaben übernehmen.'];
  if (firebase.detected) rules.push('Firebase Rules und Datenbankstruktur nie ohne Gesamtstand vollständig ersetzen. Änderungen immer ergänzend integrieren.');
  if (space.key === 'quizt') rules.push('Quizt klar getrennt von ChiefCards behandeln. Keine ChiefCards-Branding- oder Shop-Annahmen übernehmen.');
  if (repo.hasPages) rules.push('Bei GitHub-Pages-Projekten relative Pfade und statisches Hosting beachten.');
  if (conflicts?.length) rules.push('Vor Änderungen erst Scanner-Konflikte prüfen, weil Repository-Name und Code-Signale nicht sauber zusammenpassen.');
  return rules;
}
function buildWiki(ctx) {
  const { repo, purpose, tech, firebase, projectSpace, ownershipNotes, importantFiles, architecture, secrets, sharedFirebase, dataModel, routes, todos, codeInsights, scanQuality, conflicts, sourceAudit } = ctx;
  return `# ${repo.fullName}

## Scanner-Status
- Gelesene Dateien: ${sourceAudit.filesWithContent}/${sourceAudit.filesRequested}
- Gelesene Code-Dateien: ${sourceAudit.codeFilesWithContent}
- Content-Fingerprint: ${sourceAudit.contentFingerprint}
- Scan-Konfidenz: ${scanQuality.confidence}
- Top-Domäne: ${scanQuality.topDomain || 'keine'} (${scanQuality.topDomainScore || 0})
${conflicts.length ? `\n## Scanner-Konflikte\n${conflicts.map(x=>'- '+x).join('\n')}\n` : ''}
## Projektgruppe
${projectSpace.name}  
${projectSpace.separation}

${ownershipNotes.map(x=>'- '+x).join('\n')}

## Zweck
${purpose}

## Technik
${(tech || []).map(x=>'- '+x).join('\n') || '- nicht erkannt'}

## Firebase
- Projekt-IDs: ${(firebase.projectIds || []).join(', ') || 'keine erkannt'}
- Datenbank-URLs: ${(firebase.dbUrls || []).join(', ') || 'keine erkannt'}
- Feste Pfade: ${(firebase.paths || []).join(', ') || 'keine erkannt'}
- Dynamische Pfade: ${(firebase.dynamicPaths || []).join(', ') || 'keine erkannt'}
- Geteilt mit: ${(sharedFirebase || []).map(x=>`${x.fullName} (${x.space})`).join(', ') || 'nichts erkannt'}

## Architektur
${(architecture || []).map(x=>'- '+x).join('\n') || '- keine Details'}

## Code-Belege
${(codeInsights.codeFacts || []).slice(0,30).map(f=>`- ${f.kind}: ${f.file}:${f.line} → ${f.match} | ${f.snippet}`).join('\n') || '- keine Code-Belege'}

## Wichtige Funktionen
${(codeInsights.functions || []).slice(0,60).map(x=>'- '+x).join('\n') || '- keine erkannt'}

## UI-Texte
${(codeInsights.uiLabels || []).slice(0,60).map(x=>'- '+x).join('\n') || '- keine erkannt'}

## Datenmodell / Routen
- Datenmodelle: ${(dataModel || []).join(', ') || 'keine erkannt'}
- Routen/API: ${(routes || []).join(', ') || 'keine erkannt'}

## Datei-Inventar
${(codeInsights.fileSummaries || []).slice(0,40).map(x=>'- '+x).join('\n') || '- keine Datei-Zusammenfassung'}

## Wichtige Dateien
${(importantFiles || []).map(x=>'- '+x).join('\n') || '- keine erkannt'}

## Risiken
${secrets?.length ? secrets.map(x=>'- Kritisches Secret möglich: '+x).join('\n') : '- Keine kritischen Secrets erkannt.'}
${todos?.length ? todos.map(x=>'- TODO: '+x).join('\n') : ''}
`;
}
