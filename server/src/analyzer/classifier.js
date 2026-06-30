import { uniq, topCounts } from './utils.js';
const domainMap = {
  'offer-tracking': ['domain.offer'],
  'queue-management': ['domain.queue'],
  'quizt-scoreboard': ['domain.quizt'],
  'market-tools': ['domain.product'],
  'bot-service': ['domain.bot'],
  'watcher-scraper': ['domain.watcher'],
  'developer-tool': ['domain.devhub']
};
function baseDomainKind(kind) {
  if (kind.startsWith('domain.')) return kind;
  return null;
}
export function classifyProject(repo, facts) {
  const scores = Object.fromEntries(Object.keys(domainMap).map(k=>[k,0]));
  for (const f of facts) {
    const k = baseDomainKind(f.kind);
    if (!k) continue;
    for (const [domain,kinds] of Object.entries(domainMap)) if (kinds.includes(k)) scores[domain] += (f.confidence || 0.5) * (f.file?.toLowerCase().endsWith('readme.md') ? 0.25 : 1);
  }
  const name = String(repo.name || '').toLowerCase();
  if (/angebot|offer|deal/i.test(name)) scores['offer-tracking'] += 1.5;
  if (/queue/i.test(name)) scores['queue-management'] += 1.5;
  if (/quizt|score|liga/i.test(name)) scores['quizt-scoreboard'] += 1.5;
  if (/flohmarkt|bulk|product|cardmarket/i.test(name)) scores['market-tools'] += 1.2;
  if (/bot/i.test(name)) scores['bot-service'] += 1.2;
  if (/watcher|scraper/i.test(name)) scores['watcher-scraper'] += 1.2;
  if (/developer|projektgedaechtnis|devhub/i.test(name)) scores['developer-tool'] += 1.5;
  const ranked = Object.entries(scores).map(([key,score])=>({key,score:Math.round(score*10)/10})).sort((a,b)=>b.score-a.score).filter(d=>d.score>0);
  const top = ranked[0]; const second = ranked[1];
  const confidence = !top || top.score < 3 ? 'niedrig' : second && top.score - second.score < 2 ? 'mittel' : top.score > 10 ? 'hoch' : 'mittel';
  const signals = facts.filter(f => f.kind.startsWith('domain.')).map(f=>f.match.toLowerCase());
  return { ranked, scores, topDomain: top?.key || 'unknown', topScore: top?.score || 0, secondDomain: second?.key || null, secondScore: second?.score || 0, confidence, signals: topCounts(signals, 30) };
}
export function inferPurpose(classification, facts) {
  const top = classification.topDomain;
  if (classification.confidence === 'niedrig') return 'Nicht sicher erkannt. Scanner-Debug zeigt die gelesenen Code-Fakten.';
  const label = {
    'offer-tracking':'Angebots-, Deal- oder Preis-Tracking-Tool.',
    'queue-management':'Queue- oder Warteschlangen-Tool.',
    'quizt-scoreboard':'Quizt-, Punkte-, Liga- oder Scoreboard-Projekt.',
    'market-tools':'Produkt-, Bestand-, Preislisten- oder Kartenmarkt-Tool.',
    'bot-service':'Bot- oder Messaging-Dienst.',
    'watcher-scraper':'Watcher-, Scraper- oder Monitoring-Dienst.',
    'developer-tool':'Entwicklungs-, GitHub-, Deploy- oder Projektgedächtnis-Tool.'
  }[top] || `Projekt mit stärkstem Code-Signal: ${top}.`;
  const proof = facts.find(f => f.kind.startsWith('domain.') && domainMap[top]?.includes(f.kind));
  return proof ? `${label} Wichtigster Beleg: ${proof.file}:${proof.line} enthält „${proof.match}“. ` : label;
}
export function inferProjectSpace(repo, classification) {
  const text = `${repo.name} ${repo.fullName}`.toLowerCase();
  if (/quizt|quiz/i.test(text) || classification.topDomain === 'quizt-scoreboard') return { key:'quizt', name:'Quizt / Laura', type:'externes Projekt', owner:'Laura / Quizt', separation:'Quizt nicht mit ChiefCards vermischen. Fabian entwickelt Technik, aber Quizt ist inhaltlich und organisatorisch ein eigenes Projekt.' };
  if (['bot-service','watcher-scraper'].includes(classification.topDomain) || /server|vps|bot|watcher/i.test(text)) return { key:'server', name:'Server / Bots', type:'Infrastruktur', owner:'Fabian', separation:'Servernahe Dienste getrennt von Markenprojekten dokumentieren.' };
  if (/chief|card|queue|offer|angebot|flohmarkt|bulk|shop|stream|grading/i.test(text) || ['queue-management','offer-tracking','market-tools'].includes(classification.topDomain)) return { key:'chiefcards', name:'ChiefCards / Fabian', type:'eigenes Business', owner:'Fabian / ChiefCards', separation:'Gehört zu ChiefCards, Stream, Shop, Kartenhandel oder internen Tools. Quizt-Kontext nur bei echter technischer Abhängigkeit einbeziehen.' };
  return { key:'unknown', name:'Unsortiert', type:'noch einordnen', owner:'unbekannt', separation:'Projektgruppe manuell prüfen.' };
}
export function conflicts(repo, classification, firebase) {
  const out=[]; const n=String(repo.name||'').toLowerCase();
  if (/angebot|offer|deal/.test(n) && classification.topDomain==='queue-management') out.push('Repo-Name deutet auf Angebote, Code-Signale deuten auf Queue. Bitte Debug-Belege prüfen.');
  if (/queue/.test(n) && classification.topDomain==='offer-tracking') out.push('Repo-Name deutet auf Queue, Code-Signale deuten auf Angebote. Bitte Debug-Belege prüfen.');
  if ((firebase.projectIds||[]).some(id=>/queue/i.test(id)) && classification.topDomain !== 'queue-management') out.push('Firebase-Projekt-ID enthält „queue“, wird aber nicht als Zweck gewertet. Entscheidend sind Code-Pfade und Code-Fakten.');
  return out;
}
