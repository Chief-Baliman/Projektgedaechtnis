import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { addFact, snippetAtLine } from './utils.js';

const traverse = traverseModule.default || traverseModule;

function calleeName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return `${calleeName(node.object)}.${calleeName(node.property)}`.replace(/^\./, '');
  if (node.type === 'OptionalMemberExpression') return `${calleeName(node.object)}.${calleeName(node.property)}`.replace(/^\./, '');
  return '';
}

function literalValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') return String(node.value);
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis.map(q => q.value.cooked).join('');
  if (node.type === 'TemplateLiteral') return node.quasis.map((q,i) => q.value.cooked + (node.expressions[i] ? '${...}' : '')).join('');
  return null;
}

function objectValue(node) {
  if (!node || node.type !== 'ObjectExpression') return null;
  const out = {};
  for (const prop of node.properties || []) {
    if (!prop.key) continue;
    const key = prop.key.name || prop.key.value;
    const val = literalValue(prop.value);
    if (key && val != null) out[key] = val;
  }
  return out;
}

export function analyzeJavaScript(files, ctx) {
  const out = {
    imports: [],
    requires: [],
    functions: [],
    classes: [],
    calls: [],
    routes: [],
    firebase: { configs: [], refs: [], collections: [], docs: [], functions: [] },
    strings: [],
    errors: []
  };

  for (const file of files.filter(f => ['javascript','typescript','javascript-react'].includes(f.language))) {
    let ast;
    try {
      ast = parse(file.text, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript', 'classProperties', 'dynamicImport', 'optionalChaining', 'nullishCoalescingOperator']
      });
    } catch (e) {
      out.errors.push({ file: file.path, error: e.message });
      addFact(ctx.facts, { category: 'scanner', type: 'parse_error', file: file.path, line: null, value: e.message, strength: 1, reason: 'JS/TS Parser konnte Datei nicht vollständig parsen.' });
      continue;
    }

    const text = file.text;
    traverse(ast, {
      ImportDeclaration(p) {
        const source = p.node.source?.value;
        if (source) {
          out.imports.push({ file: file.path, line: p.node.loc?.start?.line, source });
          if (isImportantImport(source)) addFact(ctx.facts, { category: 'import', type: 'import', file: file.path, line: p.node.loc?.start?.line, value: source, snippet: snippetAtLine(text, p.node.loc?.start?.line), strength: 3, reason: `Import von ${source}` });
        }
      },
      CallExpression(p) {
        const name = calleeName(p.node.callee);
        if (!name) return;
        const line = p.node.loc?.start?.line;
        out.calls.push({ file: file.path, line, name });

        if (name === 'require') {
          const val = literalValue(p.node.arguments?.[0]);
          if (val) {
            out.requires.push({ file: file.path, line, source: val });
            if (isImportantImport(val)) addFact(ctx.facts, { category: 'import', type: 'require', file: file.path, line, value: val, snippet: snippetAtLine(text, line), strength: 3, reason: `require(${val})` });
          }
        }

        if (['app.get','app.post','app.put','app.patch','app.delete','router.get','router.post','router.put','router.patch','router.delete'].includes(name)) {
          const route = literalValue(p.node.arguments?.[0]);
          if (route) {
            out.routes.push({ file: file.path, line, method: name.split('.').pop().toUpperCase(), route });
            addFact(ctx.facts, { category: 'api', type: 'route', file: file.path, line, value: `${name.split('.').pop().toUpperCase()} ${route}`, snippet: snippetAtLine(text, line), strength: 4, reason: 'Express/API-Route im Code gefunden.' });
          }
        }

        if (['initializeApp','firebase.initializeApp'].includes(name)) {
          const config = objectValue(p.node.arguments?.[0]);
          out.firebase.configs.push({ file: file.path, line, config });
          addFact(ctx.facts, { category: 'firebase', type: 'initializeApp', file: file.path, line, value: 'Firebase initializeApp', snippet: snippetAtLine(text, line), strength: 4, reason: 'Firebase Initialisierung im Code.' });
          if (config) {
            for (const [k, v] of Object.entries(config)) {
              if (['projectId','databaseURL','authDomain','storageBucket','appId'].includes(k)) {
                addFact(ctx.facts, { category: 'resource', type: `firebase_${k}`, file: file.path, line, value: v, snippet: snippetAtLine(text, line), strength: 5, reason: `Firebase Ressource ${k}. Wird nicht als Projektzweck gewertet.` });
              }
            }
          }
        }

        if (name.endsWith('getDatabase') || name === 'getDatabase') {
          out.firebase.functions.push({ file: file.path, line, name: 'getDatabase' });
          addFact(ctx.facts, { category: 'firebase', type: 'realtime_database', file: file.path, line, value: 'getDatabase()', snippet: snippetAtLine(text, line), strength: 4, reason: 'Realtime Database Nutzung im Code.' });
        }

        if (name.endsWith('getFirestore') || name === 'getFirestore') {
          out.firebase.functions.push({ file: file.path, line, name: 'getFirestore' });
          addFact(ctx.facts, { category: 'firebase', type: 'firestore', file: file.path, line, value: 'getFirestore()', snippet: snippetAtLine(text, line), strength: 4, reason: 'Firestore Nutzung im Code.' });
        }

        if (['ref','firebase.database.ref','database.ref'].includes(name) || name.endsWith('.ref')) {
          const first = literalValue(p.node.arguments?.[0]);
          const second = literalValue(p.node.arguments?.[1]);
          const value = second || first || '';
          out.firebase.refs.push({ file: file.path, line, path: value, dynamic: value.includes('${...}') || !value });
          addFact(ctx.facts, { category: 'firebase', type: 'realtime_path', file: file.path, line, value: value || '[dynamisch]', snippet: snippetAtLine(text, line), strength: value ? 5 : 2, reason: value ? 'Fester Realtime-Database-Pfad im Code.' : 'Dynamischer Realtime-Database-Pfad im Code.' });
        }

        if (['collection'].includes(name) || name.endsWith('.collection')) {
          const args = p.node.arguments || [];
          const value = literalValue(args[1]) || literalValue(args[0]) || '';
          out.firebase.collections.push({ file: file.path, line, path: value, dynamic: value.includes('${...}') || !value });
          addFact(ctx.facts, { category: 'firebase', type: 'firestore_collection', file: file.path, line, value: value || '[dynamisch]', snippet: snippetAtLine(text, line), strength: value ? 5 : 2, reason: 'Firestore Collection im Code.' });
        }

        if (['doc'].includes(name) || name.endsWith('.doc')) {
          const args = p.node.arguments || [];
          const value = literalValue(args[1]) || literalValue(args[0]) || '';
          out.firebase.docs.push({ file: file.path, line, path: value, dynamic: value.includes('${...}') || !value });
        }

        const importantCalls = ['set','update','push','remove','onValue','get','runTransaction','fetch','axios.get','axios.post','bot.sendMessage','sendMessage','launch','chromium.launch'];
        if (importantCalls.some(c => name === c || name.endsWith(`.${c}`))) {
          addFact(ctx.facts, { category: 'code', type: 'call', file: file.path, line, value: name, snippet: snippetAtLine(text, line), strength: 2, reason: `Relevanter Funktionsaufruf ${name}.` });
        }
      },
      FunctionDeclaration(p) {
        const name = p.node.id?.name || '[anonymous]';
        out.functions.push({ file: file.path, line: p.node.loc?.start?.line, name, async: p.node.async });
        addFunctionFact(ctx, file, text, p.node.loc?.start?.line, name, p.node.async);
      },
      VariableDeclarator(p) {
        const init = p.node.init;
        if (!init || !['ArrowFunctionExpression','FunctionExpression'].includes(init.type)) return;
        const name = p.node.id?.name || '[anonymous]';
        out.functions.push({ file: file.path, line: p.node.loc?.start?.line, name, async: init.async });
        addFunctionFact(ctx, file, text, p.node.loc?.start?.line, name, init.async);
      },
      ClassDeclaration(p) {
        const name = p.node.id?.name || '[anonymous]';
        out.classes.push({ file: file.path, line: p.node.loc?.start?.line, name });
        addFact(ctx.facts, { category: 'code', type: 'class', file: file.path, line: p.node.loc?.start?.line, value: name, snippet: snippetAtLine(text, p.node.loc?.start?.line), strength: 3, reason: `Klasse ${name}.` });
      },
      StringLiteral(p) {
        const value = p.node.value;
        if (!value || value.length < 3 || value.length > 160) return;
        if (looksMeaningfulString(value)) out.strings.push({ file: file.path, line: p.node.loc?.start?.line, value });
      },
      TemplateLiteral(p) {
        const raw = p.node.quasis.map((q,i) => q.value.cooked + (p.node.expressions[i] ? '${...}' : '')).join('');
        if (raw && raw.length >= 3 && raw.length <= 180 && looksMeaningfulString(raw)) out.strings.push({ file: file.path, line: p.node.loc?.start?.line, value: raw });
      }
    });
  }

  return out;
}

function addFunctionFact(ctx, file, text, line, name, isAsync) {
  const lower = name.toLowerCase();
  const strong = /(offer|deal|price|queue|order|team|quiz|score|league|liga|grade|grading|psa|bot|telegram|watch|import|export|deploy|scan)/.test(lower);
  if (strong) addFact(ctx.facts, { category: 'code', type: 'function', file: file.path, line, value: `${isAsync ? 'async ' : ''}${name}()`, snippet: snippetAtLine(text, line), strength: 4, reason: 'Funktionsname ist fachlich relevant.' });
}

function isImportantImport(source) {
  return /(firebase|express|react|vue|svelte|telegram|telegraf|discord|playwright|puppeteer|axios|stripe|shopify|openai|adm-zip|multer|sqlite|mysql|postgres|mongodb)/i.test(source);
}

function looksMeaningfulString(value) {
  return /[a-zA-ZäöüÄÖÜß]{3,}/.test(value) && !/^https?:\/\//.test(value) && !/^[a-z0-9_-]+\.(js|css|png|jpg|svg)$/i.test(value);
}
