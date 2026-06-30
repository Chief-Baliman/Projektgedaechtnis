import { clean, lineNoAt, getLine, makeFact } from './utils.js';
function collectOne(file, kind, re, confidence = 0.55) {
  const content = String(file.content || '');
  const out = [];
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const rx = new RegExp(re.source, flags);
  let m;
  while ((m = rx.exec(content)) && out.length < 2000) {
    const line = lineNoAt(content, m.index);
    out.push(makeFact({ kind, file: file.path, line, match: m[1] || m[2] || m[3] || m[0], snippet: getLine(content, line), confidence }));
  }
  return out;
}
export function collectRegexFacts(files) {
  const specs = [
    ['firebase.projectId', /\bprojectId\s*[:=]\s*["'`]([^"'`]+)["'`]/gi, 0.9],
    ['firebase.databaseURL', /\bdatabaseURL\s*[:=]\s*["'`]([^"'`]+)["'`]/gi, 0.9],
    ['firebase.authDomain', /\bauthDomain\s*[:=]\s*["'`]([^"'`]+)["'`]/gi, 0.7],
    ['firebase.ref.static', /\bref\(\s*(?:db|database)\s*,\s*["'`]([^"'`]+)["'`]\s*\)/gi, 0.95],
    ['firebase.ref.dynamic', /\bref\(\s*(?:db|database)\s*,\s*(`[^`]+`|[A-Za-z_$][\w$]*(?:\[[^\]]+\])?(?:\s*\+\s*[^),]+)?)\s*\)/gi, 0.75],
    ['firebase.operation', /\b(set|update|push|onValue|get|remove|child)\s*\(/gi, 0.55],
    ['dom.uiText', /(?:placeholder|aria-label|title)=["'`]([^"'`]{3,180})["'`]/gi, 0.65],
    ['dom.buttonText', /<button[^>]*>([^<]{2,180})<\/button>/gi, 0.7],
    ['dom.heading', /<h[1-4][^>]*>([^<]{2,180})<\/h[1-4]>/gi, 0.7],
    ['api.fetch', /\bfetch\(\s*["'`]([^"'`]+)["'`]/g, 0.75],
    ['api.express', /\bapp\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]/g, 0.9],
    ['domain.offer', /\b(angebot|angebote|angebots|offer|offers|deal|deals|preisvorschlag|rabatt|discount|watchlist|priceAlert|angebotspreis)\b/gi, 0.8],
    ['domain.queue', /\b(warteschlange|bestellnummer|currentOrder|nextOrder|orderInput|remainingOrders|orderQueue|queueTracker|showFullOverlay|insertAtTop|clearQueue)\b/gi, 0.85],
    ['domain.quizt', /\b(quizt|quiz|punkte|punktestand|runde|round|team|teams|liga|league|moderator|eventcode|streetlife)\b/gi, 0.8],
    ['domain.product', /\b(produkt|produkte|product|products|bestand|stock|barcode|preis|price|inventory|cardmarket|flohmarkt|artikel|sku|display|booster)\b/gi, 0.7],
    ['domain.bot', /\b(telegram|bot|webhook|sendMessage|bot_token|discord|chat_id)\b/gi, 0.85],
    ['domain.watcher', /\b(watcher|watchlist|scraper|playwright|chromium|headless|monitor|notify|notification|gunicorn|cron)\b/gi, 0.75],
    ['domain.devhub', /\b(github|repository|repo|deploy|rollback|scanner|developer hub|projektgedächtnis|secret|token)\b/gi, 0.65],
    ['todo', /\b(?:TODO|FIXME|HACK)\b[:\s-]*(.{0,180})/gi, 0.7]
  ];
  const facts = [];
  for (const f of files) {
    if (!String(f.content || '').trim()) continue;
    for (const [kind, re, conf] of specs) facts.push(...collectOne(f, kind, re, conf));
  }
  return facts.map(f => ({ ...f, category: f.kind.split('.')[0] }));
}
