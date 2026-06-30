import { ANALYZER_VERSION, uniq } from './utils.js';
export function buildDebug(facts, inventory, classification) {
  return {
    analyzerVersion: ANALYZER_VERSION,
    inventory: inventory.files.slice(0,300),
    topFilesByFacts: inventory.files.map(f=>({ ...f, factCount:facts.filter(x=>x.file===f.path).length })).sort((a,b)=>b.factCount-a.factCount).slice(0,60),
    facts: facts.slice(0,500),
    classification,
    proofByDomain: Object.fromEntries((classification.ranked||[]).map(d => [d.key, facts.filter(f=>f.kind.startsWith('domain.')).filter(f=>domainMatches(d.key,f.kind)).slice(0,20)]))
  };
}
function domainMatches(domain, kind) {
  return ({'offer-tracking':'domain.offer','queue-management':'domain.queue','quizt-scoreboard':'domain.quizt','market-tools':'domain.product','bot-service':'domain.bot','watcher-scraper':'domain.watcher','developer-tool':'domain.devhub'})[domain] === kind;
}
export function buildWiki({ repo, purpose, tech, firebase, routes, functions, imports, uiTexts, architecture, projectSpace, conflicts, debug }) {
  const lines=[];
  lines.push(`# ${repo.fullName}`,'');
  lines.push(`Scanner-Version: ${debug.analyzerVersion}`);
  lines.push(`Fingerprint: ${debug.inventory?.[0] ? 'siehe Debug-Inventar' : 'n/a'}`,'');
  lines.push('## Zweck', purpose, '');
  lines.push('## Projektwelt', `${projectSpace.name} (${projectSpace.type})`, projectSpace.separation, '');
  lines.push('## Technik', ...(tech.length?tech.map(t=>`- ${t}`):['- nicht erkannt']), '');
  lines.push('## Architektur', ...(architecture.length?architecture.map(a=>`- ${a}`):['- nicht sicher erkannt']), '');
  if(firebase.detected){ lines.push('## Firebase als Ressource', `- Projekt-IDs: ${(firebase.projectIds||[]).join(', ')||'keine'}`, `- Database URLs: ${(firebase.dbUrls||[]).join(', ')||'keine'}`, `- feste Pfade: ${(firebase.paths||[]).join(', ')||'keine'}`, `- dynamische Pfade: ${(firebase.dynamicPaths||[]).join(', ')||'keine'}`, `- Rules-Funde: ${(firebase.rules||[]).slice(0,20).join('; ')||'keine'}`, ''); }
  if(routes.length) lines.push('## Routen / Endpunkte', ...routes.slice(0,60).map(r=>`- ${r}`), '');
  if(functions.length) lines.push('## Funktionen', ...functions.slice(0,80).map(fn=>`- ${fn}`), '');
  if(imports.length) lines.push('## Imports', ...imports.slice(0,80).map(i=>`- ${i}`), '');
  if(uiTexts.length) lines.push('## UI-Texte', ...uiTexts.slice(0,80).map(t=>`- ${t}`), '');
  if(conflicts.length) lines.push('## Konflikte / Prüfhinweise', ...conflicts.map(c=>`- ${c}`), '');
  lines.push('## Belege aus dem Code');
  for (const f of (debug.facts||[]).filter(x => x.kind.startsWith('domain.') || x.kind.startsWith('firebase.') || x.kind.startsWith('api.')).slice(0,80)) lines.push(`- ${f.kind} ${f.file}:${f.line} „${f.match}“`);
  return lines.join('\n');
}
export function buildGuardrails(projectSpace, firebase, classification) {
  const out = ['Bestehende Funktionen erhalten. Änderungen nur auf Basis des aktuell gelesenen Codes machen.', 'Keine Secrets, Tokens oder Passwörter in ZIPs oder Chat-Ausgaben übernehmen.'];
  if(firebase.detected) out.push('Firebase-Projekt-ID ist nur Ressourcenname. Zweck aus Code-Pfaden, Funktionen und UI ableiten. Firebase Rules nie komplett ersetzen, ohne Gesamtstand zu berücksichtigen.');
  if(projectSpace.key==='quizt') out.push('Quizt ist extern für Laura und darf nicht mit ChiefCards vermischt werden.');
  if(classification.confidence!=='hoch') out.push('Projektzweck ist nicht hochsicher erkannt. Vor größeren Änderungen Scanner-Debug prüfen.');
  return out;
}
export function health({ inventory, firebase, conflicts, classification, secrets, todos }) {
  return [
    { label:'Code gelesen', status: inventory.codeFiles > 0 ? 'ok' : 'danger' },
    { label:'Scanner-Konfidenz', status: classification.confidence==='hoch' ? 'ok' : classification.confidence==='mittel' ? 'warn' : 'danger' },
    { label:'Firebase erkannt', status: firebase.detected ? 'ok' : 'neutral' },
    { label:'Konflikte', status: conflicts.length ? 'warn' : 'ok' },
    { label:'Kritische Secrets im Code', status: secrets.length ? 'danger' : 'ok' },
    { label:'TODOs gefunden', status: todos.length ? 'warn' : 'ok' }
  ];
}
export function detectSecrets(files) {
  const out=[]; const allowedFirebase=/apiKey\s*[:=]\s*["'`]AIza[\w-]+["'`]/;
  const patterns=[/bot[_-]?token\s*[:=]\s*["'`][^"'`]{20,}["'`]/i,/secret\s*[:=]\s*["'`][^"'`]{20,}["'`]/i,/password\s*[:=]\s*["'`][^"'`]{8,}["'`]/i,/private[_-]?key\s*[:=]/i];
  for(const f of files){ const c=String(f.content||''); if(allowedFirebase.test(c)){} for(const p of patterns){ const m=c.match(p); if(m) out.push(`${f.path}: ${m[0].slice(0,80)}`); } }
  return out.slice(0,50);
}
