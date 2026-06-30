const TEXT_EXT = /\.(html|js|ts|tsx|jsx|json|md|css|yml|yaml|env|txt|rules|cjs|mjs|py|service|toml|ini|conf)$/i;
const MAX_FILES = 220;
const MAX_FILE_SIZE = 420000;
const uniq = arr => [...new Set(arr.filter(Boolean))];
const findAll = (re, txt) => [...txt.matchAll(re)].map(m => m[1] || m[0]);
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

export function shouldReadFile(item) {
  return item.type === 'blob' && TEXT_EXT.test(item.path) && (item.size || 0) <= MAX_FILE_SIZE && !/node_modules|dist|build|vendor|\.min\.js|package-lock\.json|pnpm-lock|yarn\.lock/i.test(item.path);
}

export function limitReadable(tree) {
  return tree.filter(shouldReadFile).sort((a,b) => score(a.path) - score(b.path)).slice(0, MAX_FILES);
}
function score(p) {
  if (/^(README\.md|index\.html|package\.json|firebase\.json|database\.rules\.json|firestore\.rules|\.env\.example)$/i.test(p)) return 0;
  if (/^(src|server|app|pages|components|lib|scripts|functions)\//i.test(p)) return 1;
  if (/firebase|database|rules|config|main|app|index|vite|next|nuxt|requirements|\.service|docker|nginx/i.test(p)) return 2;
  return 5;
}

export function analyzeRepository(repo, files, allKnownProjects = []) {
  const paths = files.map(f => f.path);
  const joined = files.map(f => `\n--- ${f.path} ---\n${f.content}`).join('\n');
  const lower = joined.toLowerCase();
  const codeInsights = inferCodeInsights(repo, files, joined);
  const tech = inferTech(paths, lower, codeInsights);
  const firebase = inferFirebase(joined, lower);
  const bots = inferBots(joined, repo);
  const projectSpace = inferProjectSpace(repo, joined, codeInsights);
  const purpose = inferPurpose(repo, joined, projectSpace, codeInsights);
  const architecture = inferArchitecture(paths, joined, repo, codeInsights);
  const dataModel = inferDataModel(joined, codeInsights);
  const routes = inferRoutes(joined);
  const importantFiles = paths.filter(p => /^(index\.html|package\.json|firebase\.json|database\.rules\.json|README\.md|\.env\.example|\.github\/workflows|server|src\/|app\.py|main\.py|requirements\.txt|vite\.config|tailwind|nginx|docker|Dockerfile)/i.test(p)).slice(0, 80);
  const todos = uniq(findAll(/\b(?:TODO|FIXME|HACK)\b[:\s-]*(.{0,140})/gi, joined).map(x => clean(x))).slice(0, 40);
  const secrets = detectSecrets(files);
  const sharedFirebase = allKnownProjects.filter(p => p.fullName !== repo.fullName && (p.analysis?.firebase?.projectIds || []).some(id => firebase.projectIds.includes(id))).map(p => ({ fullName:p.fullName, space:p.analysis?.projectSpace?.name || 'Unbekannt' }));
  const related = inferRelated(repo, projectSpace, firebase, allKnownProjects);
  const ownershipNotes = inferOwnershipNotes(projectSpace);
  const scanQuality = inferScanQuality(files, codeInsights);
  const health = [
    { label: 'README vorhanden', status: paths.some(p => /^README\.md$/i.test(p)) ? 'ok' : 'warn' },
    { label: 'GitHub Pages', status: repo.hasPages ? 'ok' : 'neutral' },
    { label: 'Firebase erkannt', status: firebase.detected ? 'ok' : 'neutral' },
    { label: 'Kritische Secrets im Code', status: secrets.length ? 'danger' : 'ok' },
    { label: 'TODOs gefunden', status: todos.length ? 'warn' : 'ok' },
    { label: 'Code-Signatur erkannt', status: codeInsights.signature.length ? 'ok' : 'warn' },
    { label: 'Projektgruppe', status: projectSpace.key === 'unknown' ? 'warn' : 'ok' }
  ];
  const wiki = buildWiki({ repo, purpose, tech, firebase, bots, projectSpace, ownershipNotes, importantFiles, architecture, secrets, sharedFirebase, dataModel, routes, todos, codeInsights, scanQuality });
  return {
    repoName: repo.name, fullName: repo.fullName, purpose, defaultBranch: repo.defaultBranch, htmlUrl: repo.htmlUrl,
    pagesUrl: repo.hasPages ? `https://${repo.fullName.split('/')[0]}.github.io/${repo.name}/` : '', updatedAt: repo.updatedAt,
    fileCount: paths.length, scannedFiles: files.length, tech, projectSpace, ownershipNotes,
    firebase: { ...firebase, sharedWith: sharedFirebase },
    bots, routes, dataModel, codeInsights, scanQuality, relatedProjects: related,
    hosting: repo.hasPages ? ['GitHub Pages aktiv'] : [], importantFiles, architecture, secretWarnings: secrets, todos, health, wiki,
    scannedAt: new Date().toISOString(), guardrails: buildGuardrails(projectSpace, firebase, repo, codeInsights)
  };
}

function inferTech(paths, lower, insights) {
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
  if (insights.domains.includes('offer-tracking')) tech.push('Angebots-Tracking');
  if (insights.domains.includes('queue-management')) tech.push('Queue-Verwaltung');
  if (insights.domains.includes('scoreboard')) tech.push('Scoreboard');
  return uniq(tech);
}

function inferFirebase(joined, lower) {
  const projectIds = uniq(findAll(/projectId\s*[:=]\s*["'`]([^"'`]+)["'`]/g, joined));
  const dbUrls = uniq(findAll(/databaseURL\s*[:=]\s*["'`]([^"'`]+)["'`]/g, joined));
  const paths = uniq([
    ...findAll(/ref\(\s*db\s*,\s*["'`]([^"'`]+)["'`]\s*\)/g, joined),
    ...findAll(/ref\(\s*database\s*,\s*["'`]([^"'`]+)["'`]\s*\)/g, joined),
    ...findAll(/child\([^,]*,\s*["'`]([^"'`]+)["'`]\)/g, joined),
    ...findAll(/(?:set|update|push|onValue|get|remove)\(\s*ref\([^,]+,\s*["'`]([^"'`]+)["'`]/g, joined),
    ...findAll(/(?:collection|doc)\(\s*[^,]+,\s*["'`]([^"'`]+)["'`]/g, joined)
  ]).filter(p => !/^https?:/.test(p) && !p.includes('${'));
  const rulesMentioned = /database\.rules|\.read|\.write|firebase rules|rules_version/i.test(joined);
  return { detected: Boolean(projectIds.length || dbUrls.length || lower.includes('firebase')), projectIds, dbUrls, paths, rulesMentioned };
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
  if (/quizt|quiz_mit_twist|streetlife|liga|scoreboard|quizabend/.test(name + ' ' + lower)) {
    return { key:'quizt', name:'Quizt / Laura', type:'externes Projekt', owner:'Laura / Quizt', separation:'Nicht mit ChiefCards vermischen. Fabian entwickelt Technik, aber Quizt ist inhaltlich und organisatorisch ein eigenes Projekt.' };
  }
  if (/telegram|bot|watcher|vps|server|gunicorn|systemd/.test(name + ' ' + lower) && !/chiefcards|chief-bali|queue|offer|angebot|flohmarkt|bulk|cardmarket|otakuya|jp-display|ofcs/.test(name)) {
    return { key:'server', name:'Server / Bots', type:'Infrastruktur', owner:'Fabian', separation:'Servernahe Dienste getrennt von einzelnen Markenprojekten dokumentieren.' };
  }
  if (/chiefcards|chief-bali|queue|stream|offer|angebot|roadtoglo|pullcounter|flohmarkt|bulk|cardmarket|otakuya|jp-display|ofcs/.test(name + ' ' + lower) || insights.domains.some(d => ['offer-tracking','queue-management','market-tools','stream-tools'].includes(d))) {
    return { key:'chiefcards', name:'ChiefCards / Fabian', type:'eigenes Business', owner:'Fabian / ChiefCards', separation:'Gehört zu ChiefCards, Stream, Shop, Kartenhandel oder internen Tools.' };
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
  if (space.key === 'server') return [
    'Serverdienst oder Bot. Vor Änderungen prüfen, ob systemd, Ports oder bestehende Dienste betroffen sind.',
    'Nicht mit einem einzelnen Markenprojekt vermischen, wenn der Dienst mehrere Projekte unterstützt.'
  ];
  return ['Projektgruppe noch nicht sicher erkannt. Vor größeren Änderungen manuell einordnen.'];
}

function inferPurpose(repo, txt, space, insights) {
  const name = repo.name.toLowerCase();
  const hay = `${name}\n${txt}`.toLowerCase();
  if (space.key === 'quizt') {
    if (/scoreboard|punkte|moderator|liga/.test(hay)) return 'Quizt-Anwendung für Punkteübersicht, Moderation, Events und Liga. Externes Projekt für Laura, nicht ChiefCards.';
    return 'Quizt-Website oder Quizt-Tool. Externes Projekt für Laura, getrennt von ChiefCards.';
  }
  if (insights.domains.includes('offer-tracking') || /angebot|angebote|offer|deal|preisangebot|ankaufangebot/.test(hay)) return 'ChiefCards Angebots-Tracker zur Verwaltung, Bewertung oder Nachverfolgung von Angeboten und Deals.';
  if (insights.domains.includes('queue-management') || /queue|warteschlange|bestellnummer|currentorder|nextorder/.test(hay)) return 'Livestream-Overlay und Verwaltungsoberfläche für eine Bestellwarteschlange.';
  if (insights.domains.includes('market-tools') || /flohmarkt|bestand|preis|barcode|produkt|inventory|stock/.test(hay)) return 'ChiefCards Tool für Produkte, Preise, Bestände oder mobile Verkaufsverwaltung.';
  if (/watchlist|watcher|product watcher|playwright|scraper/.test(hay)) return 'Serverseitiger Watcher oder Dashboard zur Produktbeobachtung.';
  if (/telegram|bot/.test(hay)) return 'Bot-Anwendung mit Telegram oder Webhook-Anbindung.';
  if (/bulk/.test(name)) return 'Tool zur Analyse oder Verarbeitung von Bulk-Karten.';
  return repo.description || 'Zweck nicht eindeutig erkannt. Bitte einmal manuell ergänzen.';
}

function inferArchitecture(paths, txt, repo, insights) {
  const lower = txt.toLowerCase();
  const a = [];
  if (paths.length === 1 && paths.includes('index.html')) a.push('Ein-Datei-App: index.html enthält Oberfläche, Logik und Styles. Scanner hat den tatsächlichen Inhalt dieser Datei ausgewertet.');
  if (lower.includes('firebasejs') && lower.includes('gstatic.com')) a.push('Firebase wird clientseitig per CDN eingebunden.');
  if (lower.includes('getdatabase') || lower.includes('realtime')) a.push('Nutzt Firebase Realtime Database.');
  if (lower.includes('urlsearchparams')) a.push('URL-Parameter steuern Modi oder Ansichten.');
  if (paths.includes('package.json')) a.push('Node/JavaScript-Projekt mit package.json.');
  if (paths.some(p => p.startsWith('server/'))) a.push('Backend-Struktur vorhanden.');
  if (paths.some(p => p.startsWith('src/'))) a.push('Quellcode liegt im src-Verzeichnis.');
  if (repo.hasPages) a.push('GitHub Pages ist laut Repository aktiv.');
  if (insights.functions.length) a.push(`Wichtige Funktionen erkannt: ${insights.functions.slice(0, 12).join(', ')}.`);
  if (insights.uiLabels.length) a.push(`UI-Texte/Buttons deuten auf konkrete App-Funktionen hin: ${insights.uiLabels.slice(0, 12).join(', ')}.`);
  return a;
}

function inferDataModel(txt, insights) {
  const keys = uniq([
    ...findAll(/(?:const|let|var)\s+([A-Za-z0-9_]*(?:State|Data|Config|Event|Team|Queue|Product|League|Offer|Deal|Angebot|Preis|Bestand)[A-Za-z0-9_]*)\s*=/g, txt),
    ...findAll(/localStorage\.setItem\(["'`]([^"'`]+)["'`]/g, txt),
    ...findAll(/sessionStorage\.setItem\(["'`]([^"'`]+)["'`]/g, txt),
    ...insights.stateKeys,
    ...insights.storageKeys
  ]).slice(0, 50);
  return keys;
}

function inferRoutes(txt) {
  return uniq([
    ...findAll(/app\.(?:get|post|put|delete|patch)\(["'`]([^"'`]+)["'`]/g, txt),
    ...findAll(/fetch\(["'`]([^"'`]+)["'`]/g, txt)
  ]).slice(0, 50);
}

function inferRelated(repo, space, firebase, allKnownProjects) {
  return allKnownProjects.filter(p => p.fullName !== repo.fullName).map(p => {
    const sameFirebase = (p.analysis?.firebase?.projectIds || []).some(id => firebase.projectIds.includes(id));
    const sameSpace = p.analysis?.projectSpace?.key && p.analysis.projectSpace.key === space.key;
    if (!sameFirebase && !sameSpace) return null;
    return { fullName:p.fullName, reason:sameFirebase ? 'teilt Firebase-Ressource' : 'gleiche Projektgruppe', space:p.analysis?.projectSpace?.name || 'Unbekannt', hardDependency:sameFirebase };
  }).filter(Boolean);
}

function inferCodeInsights(repo, files, joined) {
  const name = repo.name.toLowerCase();
  const lower = joined.toLowerCase();
  const functions = uniq([
    ...findAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g, joined),
    ...findAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g, joined),
    ...findAll(/window\.([A-Za-z_$][\w$]*)\s*=/g, joined)
  ]).filter(x => !/^anonymous$|^then$|^catch$/.test(x)).slice(0, 80);
  const stateKeys = uniq([
    ...findAll(/state\.([A-Za-z_$][\w$]*)/g, joined),
    ...findAll(/data\.([A-Za-z_$][\w$]*)/g, joined),
    ...findAll(/\b([A-Za-z_$][\w$]*(?:Queue|Offer|Deal|Product|Item|Team|Round|League|Event|Score|Price|Stock|Order|Angebot|Preis|Bestand)[A-Za-z_$0-9]*)\b/g, joined)
  ]).slice(0, 80);
  const storageKeys = uniq([
    ...findAll(/localStorage\.(?:getItem|setItem|removeItem)\(["'`]([^"'`]+)["'`]/g, joined),
    ...findAll(/sessionStorage\.(?:getItem|setItem|removeItem)\(["'`]([^"'`]+)["'`]/g, joined)
  ]).slice(0, 50);
  const uiLabels = uniq([
    ...findAll(/<button[^>]*>([^<]{2,80})<\/button>/gi, joined).map(clean),
    ...findAll(/placeholder=["'`]([^"'`]{2,80})["'`]/gi, joined).map(clean),
    ...findAll(/aria-label=["'`]([^"'`]{2,80})["'`]/gi, joined).map(clean),
    ...findAll(/title=["'`]([^"'`]{2,80})["'`]/gi, joined).map(clean)
  ]).filter(x => !/[{};]/.test(x)).slice(0, 80);
  const domains = [];
  if (/angebot|angebote|offer|offers|deal|deals|price offer|ankaufangebot/.test(`${name} ${lower}`)) domains.push('offer-tracking');
  if (/queue|warteschlange|bestellnummer|currentorder|nextorder|orderinput/.test(`${name} ${lower}`)) domains.push('queue-management');
  if (/flohmarkt|bestand|barcode|inventory|stock|produkt|product|preis|price/.test(`${name} ${lower}`)) domains.push('market-tools');
  if (/scoreboard|punkte|round|runde|team|liga|league|moderator/.test(`${name} ${lower}`)) domains.push('scoreboard');
  if (/stream|overlay|twitch|obs/.test(`${name} ${lower}`)) domains.push('stream-tools');
  if (/telegram|bot|webhook/.test(`${name} ${lower}`)) domains.push('bot');
  if (/watcher|scraper|playwright|chromium/.test(`${name} ${lower}`)) domains.push('watcher');
  const signature = uniq([
    ...functions.slice(0, 12).map(f => `fn:${f}`),
    ...stateKeys.slice(0, 12).map(k => `key:${k}`),
    ...uiLabels.slice(0, 8).map(l => `ui:${l}`),
    ...domains.map(d => `domain:${d}`)
  ]).slice(0, 40);
  const fileSummaries = files.map(f => summarizeFile(f)).filter(Boolean).slice(0, 60);
  return { domains: uniq(domains), functions, stateKeys, storageKeys, uiLabels, signature, fileSummaries };
}

function summarizeFile(f) {
  const txt = f.content || '';
  const lower = txt.toLowerCase();
  const parts = [];
  if (/firebase/.test(lower)) parts.push('Firebase');
  if (/getdatabase|realtime|onvalue|ref\(/.test(lower)) parts.push('Realtime DB');
  if (/angebot|offer|deal/.test(lower)) parts.push('Angebote/Deals');
  if (/queue|warteschlange|order/.test(lower)) parts.push('Queue/Bestellungen');
  if (/team|runde|score|liga|league/.test(lower)) parts.push('Quiz/Score');
  if (/express|app\.get|app\.post/.test(lower)) parts.push('Backend/API');
  if (/telegram|bot/.test(lower)) parts.push('Bot');
  if (/playwright|watcher|scraper/.test(lower)) parts.push('Watcher/Scraper');
  if (!parts.length) return null;
  return `${f.path}: ${parts.join(', ')}`;
}

function inferScanQuality(files, insights) {
  const html = files.filter(f => f.path.endsWith('.html')).length;
  const js = files.filter(f => /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(f.path)).length;
  const meaningful = insights.functions.length + insights.stateKeys.length + insights.uiLabels.length + insights.domains.length;
  const note = meaningful > 20 ? 'hoch' : meaningful > 8 ? 'mittel' : 'niedrig';
  return { filesRead: files.length, htmlFiles: html, codeFiles: js, extractedSignals: meaningful, quality: note };
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

function buildGuardrails(space, firebase, repo, insights) {
  const base = [
    'Bestehende Funktionen erhalten und Änderungen gezielt einbauen.',
    'Secrets, Tokens, Private Keys und Passwörter nicht in ZIPs, Code oder Chat-Ausgaben übernehmen.',
    'ZIP-Deploy überschreibt nur Pfade aus der ZIP. Nicht enthaltene Repo-Dateien bleiben bestehen.',
    'Vor Änderungen die Code-Signatur beachten, damit nicht aus einem anderen Projekt versehentlich falsche Logik übernommen wird.'
  ];
  if (firebase.detected) base.push('Firebase Rules und Datenbankstruktur nie ohne Gesamtstand vollständig ersetzen. Änderungen immer integrieren.');
  if (repo.hasPages) base.push('Bei GitHub-Pages-Projekten relative Pfade und statisches Hosting beachten.');
  if (space.key === 'quizt') base.unshift('Quizt ist extern für Laura. Nicht mit ChiefCards, ChiefBaliman, Shop, Kartenhandel oder Stream-Branding vermischen.');
  if (insights.domains.includes('offer-tracking')) base.push('Dieses Projekt ist Angebots-/Deal-Tracking. Nicht als Queue-Tracker oder Bestellwarteschlange behandeln.');
  if (insights.domains.includes('queue-management')) base.push('Dieses Projekt verwaltet eine Queue/Warteschlange. Reihenfolge, aktuelle Bestellung und Overlay-Modus erhalten.');
  return base;
}

function buildWiki(x) {
  return `# ${x.repo.fullName}\n\n## Projektgruppe\n- Bereich: ${x.projectSpace.name}\n- Typ: ${x.projectSpace.type}\n- Verantwortlich: ${x.projectSpace.owner}\n- Trennung: ${x.projectSpace.separation}\n\n## Zweck\n${x.purpose}\n\n## Scan-Qualität\n- Gelesene Dateien: ${x.scanQuality.filesRead}\n- Code-Dateien: ${x.scanQuality.codeFiles}\n- HTML-Dateien: ${x.scanQuality.htmlFiles}\n- Erkannte Code-Signale: ${x.scanQuality.extractedSignals}\n- Qualität: ${x.scanQuality.quality}\n\n## Code-Signatur\n${x.codeInsights.signature.length ? x.codeInsights.signature.map(s => `- ${s}`).join('\n') : '- Keine eindeutige Code-Signatur erkannt'}\n\n## Erkannte App-Domänen\n${x.codeInsights.domains.length ? x.codeInsights.domains.map(d => `- ${d}`).join('\n') : '- Keine Domäne sicher erkannt'}\n\n## Besitz- und Kontextregeln\n${x.ownershipNotes.map(n => `- ${n}`).join('\n')}\n\n## Technik\n${x.tech.length ? x.tech.map(t => `- ${t}`).join('\n') : '- Nicht eindeutig erkannt'}\n\n## Hosting\n${x.repo.hasPages ? `- GitHub Pages: https://${x.repo.fullName.split('/')[0]}.github.io/${x.repo.name}/` : '- Kein GitHub Pages erkannt'}\n\n## Firebase\n${x.firebase.projectIds.length ? x.firebase.projectIds.map(p => `- Projekt-ID: ${p}`).join('\n') : '- Keine Projekt-ID erkannt'}\n${x.firebase.dbUrls.length ? x.firebase.dbUrls.map(u => `- Database URL: ${u}`).join('\n') : ''}\n${x.firebase.paths.length ? x.firebase.paths.map(p => `- Datenpfad: ${p}`).join('\n') : ''}\n${x.sharedFirebase.length ? `\nGeteilte Firebase-Ressourcen:\n${x.sharedFirebase.map(p => `- ${p.fullName} (${p.space})`).join('\n')}` : ''}\n\n## Architektur\n${x.architecture.length ? x.architecture.map(a => `- ${a}`).join('\n') : '- Keine sichere Architektur-Zusammenfassung möglich'}\n\n## Erkannte Funktionen\n${x.codeInsights.functions.length ? x.codeInsights.functions.slice(0, 40).map(k => `- ${k}`).join('\n') : '- Keine Funktionen erkannt'}\n\n## Erkannte UI-Texte\n${x.codeInsights.uiLabels.length ? x.codeInsights.uiLabels.slice(0, 40).map(k => `- ${k}`).join('\n') : '- Keine UI-Texte erkannt'}\n\n## Erkannte Datenmodelle / Schlüssel\n${x.dataModel.length ? x.dataModel.map(k => `- ${k}`).join('\n') : '- Keine klaren Datenmodelle erkannt'}\n\n## Erkannte Routen / API-Pfade\n${x.routes.length ? x.routes.map(r => `- ${r}`).join('\n') : '- Keine Routen erkannt'}\n\n## Datei-Zusammenfassung\n${x.codeInsights.fileSummaries.length ? x.codeInsights.fileSummaries.map(f => `- ${f}`).join('\n') : '- Keine Datei-Zusammenfassung möglich'}\n\n## Wichtige Dateien\n${x.importantFiles.length ? x.importantFiles.map(f => `- ${f}`).join('\n') : '- Keine wichtigen Dateien erkannt'}\n\n## Risiken\n${x.secrets.length ? x.secrets.map(s => `- ${s}`).join('\n') : '- Keine kritischen Secrets erkannt'}\n${x.todos.length ? `\n## TODOs\n${x.todos.map(t => `- ${t}`).join('\n')}` : ''}\n\n## Änderungsregeln\n- Bestehende Funktionen erhalten.\n- Projektgruppe beachten und fremde Marken-/Business-Kontexte nicht vermischen.\n- Code-Signatur beachten. Wenn Angebot/Deal erkannt wurde, nicht als Queue-Projekt behandeln.\n- Firebase-Strukturen nicht blind ersetzen.\n- Secrets niemals in ChatGPT-Prompts oder ZIP-Dateien übernehmen.\n`;}
