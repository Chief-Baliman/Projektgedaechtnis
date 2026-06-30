import { Parser } from 'acorn';
import * as walk from 'acorn-walk';
import { makeFact, getLine } from './utils.js';
function parseCode(code, sourceType) {
  return Parser.parse(code, { ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true, allowAwaitOutsideFunction: true });
}
function literalValue(node) { return node && node.type === 'Literal' ? String(node.value) : null; }
function memberName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return `${memberName(node.object)}.${memberName(node.property)}`;
  if (node.type === 'Literal') return String(node.value);
  return node.type;
}
function exprText(node) {
  if (!node) return '';
  if (node.type === 'Literal') return JSON.stringify(node.value);
  if (node.type === 'TemplateLiteral') return '`' + node.quasis.map(q=>q.value.raw).join('${...}') + '`';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return memberName(node);
  if (node.type === 'BinaryExpression') return `${exprText(node.left)} ${node.operator} ${exprText(node.right)}`;
  if (node.type === 'CallExpression') return `${memberName(node.callee)}(...)`;
  return node.type;
}
export function analyzeJavaScriptAst(files) {
  const facts = [];
  for (const file of files.filter(f => /\.(js|mjs|cjs|jsx|ts|tsx)$/i.test(f.path))) {
    const code = String(file.content || '');
    if (!code.trim()) continue;
    let ast;
    try { ast = parseCode(code, 'module'); } catch { try { ast = parseCode(code, 'script'); } catch(e) { facts.push(makeFact({ kind:'parse.error', file:file.path, line:1, match:e.message, snippet:e.message, confidence:0.3, details:{ parser:'acorn' } })); continue; } }
    walk.simple(ast, {
      ImportDeclaration(n) {
        facts.push(makeFact({ kind:'js.import', file:file.path, line:n.loc.start.line, match:n.source.value, snippet:getLine(code,n.loc.start.line), confidence:0.95, details:{ specifiers:n.specifiers?.map(s=>s.local?.name).filter(Boolean) || [] } }));
      },
      FunctionDeclaration(n) {
        if (n.id?.name) facts.push(makeFact({ kind:'js.function', file:file.path, line:n.loc.start.line, match:n.id.name, snippet:getLine(code,n.loc.start.line), confidence:0.9, details:{ params:n.params?.length || 0 } }));
      },
      VariableDeclarator(n) {
        if (n.id?.name && ['ArrowFunctionExpression','FunctionExpression'].includes(n.init?.type)) facts.push(makeFact({ kind:'js.function', file:file.path, line:n.loc.start.line, match:n.id.name, snippet:getLine(code,n.loc.start.line), confidence:0.85, details:{ params:n.init.params?.length || 0 } }));
        if (n.id?.name && n.init?.type === 'ObjectExpression') facts.push(makeFact({ kind:'js.object', file:file.path, line:n.loc.start.line, match:n.id.name, snippet:getLine(code,n.loc.start.line), confidence:0.75, details:{ keys:n.init.properties?.map(p=>p.key?.name || p.key?.value).filter(Boolean).slice(0,30) || [] } }));
      },
      Property(n) {
        const key = n.key?.name || n.key?.value;
        const v = literalValue(n.value);
        if (key && ['projectId','databaseURL','authDomain','apiKey','storageBucket','messagingSenderId','appId'].includes(String(key))) facts.push(makeFact({ kind:`firebase.config.${key}`, file:file.path, line:n.loc.start.line, match:v || exprText(n.value), snippet:getLine(code,n.loc.start.line), confidence:0.95 }));
      },
      CallExpression(n) {
        const callee = memberName(n.callee);
        if (callee === 'ref' || callee.endsWith('.ref')) {
          const arg = n.arguments?.[1] || n.arguments?.[0];
          facts.push(makeFact({ kind:'firebase.ref.ast', file:file.path, line:n.loc.start.line, match:exprText(arg), snippet:getLine(code,n.loc.start.line), confidence:0.9, details:{ static: arg?.type === 'Literal' } }));
        }
        if (/^(set|update|push|onValue|get|remove|child)$/.test(callee.split('.').pop())) facts.push(makeFact({ kind:'firebase.operation.ast', file:file.path, line:n.loc.start.line, match:callee, snippet:getLine(code,n.loc.start.line), confidence:0.75 }));
        if (callee === 'fetch') facts.push(makeFact({ kind:'api.fetch.ast', file:file.path, line:n.loc.start.line, match:exprText(n.arguments?.[0]), snippet:getLine(code,n.loc.start.line), confidence:0.85 }));
        const routeMethod = callee.match(/app\.(get|post|put|delete|patch)$/)?.[1];
        if (routeMethod) facts.push(makeFact({ kind:'api.express.ast', file:file.path, line:n.loc.start.line, match:`${routeMethod.toUpperCase()} ${exprText(n.arguments?.[0])}`, snippet:getLine(code,n.loc.start.line), confidence:0.95 }));
      }
    });
  }
  return facts;
}
