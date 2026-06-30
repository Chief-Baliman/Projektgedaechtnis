import { makeFact, lineNoAt, getLine } from './utils.js';
export function analyzeFirebaseRules(files) {
  const facts = [];
  for (const file of files.filter(f => /rules|database\.rules|firestore\.rules|storage\.rules/i.test(f.path))) {
    const c = String(file.content || '');
    const patterns = [
      ['rules.path', /(?:match|"|')\s*\/?([A-Za-z0-9_$\-{}/*]+)\/?(?:"|'|\s*\{)/g],
      ['rules.read', /\.read|allow\s+read/g],
      ['rules.write', /\.write|allow\s+write/g],
      ['rules.auth', /auth\s*(!=|==)|request\.auth/g]
    ];
    for (const [kind,re] of patterns) { let m; while((m=re.exec(c))) { const line=lineNoAt(c,m.index); facts.push(makeFact({ kind, file:file.path, line, match:m[1]||m[0], snippet:getLine(c,line), confidence:0.75 })); } }
  }
  return facts;
}
