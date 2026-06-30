import { makeFact } from './utils.js';
function walkJson(obj, path, file, facts) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach((v,i)=>walkJson(v, `${path}[${i}]`, file, facts)); return; }
  for (const [k,v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (['scripts','dependencies','devDependencies'].includes(k) && typeof v === 'object') facts.push(makeFact({ kind:`json.${k}`, file:file.path, line:1, match:Object.keys(v).join(', '), snippet:p, confidence:0.9, details:{ keys:Object.keys(v).slice(0,80) } }));
    if (['projectId','databaseURL','authDomain','hosting','rewrites','rules','database','functions'].includes(k)) facts.push(makeFact({ kind:`json.key.${k}`, file:file.path, line:1, match:typeof v === 'string' ? v : p, snippet:p, confidence:0.8 }));
    walkJson(v, p, file, facts);
  }
}
export function analyzeJson(files) {
  const facts = [];
  for (const file of files.filter(f => /\.json$/i.test(f.path) || /\.firebaserc$/i.test(f.path))) {
    try { walkJson(JSON.parse(String(file.content || '{}')), '', file, facts); } catch(e) { facts.push(makeFact({ kind:'json.parse.error', file:file.path, line:1, match:e.message, snippet:e.message, confidence:0.3 })); }
  }
  return facts;
}
