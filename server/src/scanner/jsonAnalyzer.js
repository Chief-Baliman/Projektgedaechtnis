import { addFact, safeJsonParse, snippetAtLine } from './utils.js';

export function analyzeJson(files, ctx) {
  const out = { packageJson: [], firebaseJson: [], rules: [], jsonFiles: [], errors: [] };
  for (const file of files.filter(f => f.language === 'json' || f.path.endsWith('.rules.json'))) {
    const parsed = safeJsonParse(file.text);
    if (!parsed.ok) {
      out.errors.push({ file:file.path, error:parsed.error });
      addFact(ctx.facts, { category:'json', type:'parse_error', file:file.path, value:parsed.error, strength:1, reason:'JSON konnte nicht gelesen werden.' });
      continue;
    }
    const data = parsed.value;
    out.jsonFiles.push({ file:file.path, keys:Object.keys(data || {}).slice(0, 40) });

    const base = file.path.split('/').pop().toLowerCase();
    if (base === 'package.json') {
      const deps = { ...(data.dependencies || {}), ...(data.devDependencies || {}) };
      const scripts = data.scripts || {};
      out.packageJson.push({ file:file.path, name:data.name, version:data.version, scripts, dependencies:Object.keys(deps) });
      addFact(ctx.facts, { category:'project', type:'package', file:file.path, line:1, value:`${data.name || 'package'} ${data.version || ''}`.trim(), snippet: snippetAtLine(file.text,1), strength:3, reason:'package.json gelesen.' });
      for (const dep of Object.keys(deps)) {
        if (/(firebase|express|react|vue|svelte|telegram|telegraf|discord|playwright|puppeteer|axios|shopify|openai|stripe)/i.test(dep)) {
          addFact(ctx.facts, { category:'dependency', type:'npm', file:file.path, line: findLine(file.text, dep), value:dep, snippet: snippetAtLine(file.text, findLine(file.text, dep)), strength:4, reason:'Wichtige npm-Abhängigkeit.' });
        }
      }
    }

    if (base === 'firebase.json') {
      out.firebaseJson.push({ file:file.path, hosting:Boolean(data.hosting), functions:Boolean(data.functions), database:data.database || null, firestore:data.firestore || null, storage:data.storage || null });
      addFact(ctx.facts, { category:'firebase', type:'firebase_json', file:file.path, line:1, value:'firebase.json', snippet: snippetAtLine(file.text,1), strength:4, reason:'Firebase-Konfigurationsdatei vorhanden.' });
      if (data.hosting) addFact(ctx.facts, { category:'hosting', type:'firebase_hosting', file:file.path, line: findLine(file.text,'hosting'), value:'Firebase Hosting', snippet: snippetAtLine(file.text, findLine(file.text,'hosting')), strength:4, reason:'Firebase Hosting konfiguriert.' });
    }

    if (base.includes('rules')) {
      const paths = extractRulePaths(data);
      out.rules.push({ file:file.path, paths });
      for (const p of paths) {
        addFact(ctx.facts, { category:'firebase', type:'rules_path', file:file.path, line: findLine(file.text, p.split('/').pop()), value:p, snippet: snippetAtLine(file.text, findLine(file.text, p.split('/').pop())), strength:5, reason:'Pfad aus Firebase Rules gelesen.' });
      }
    }
  }
  return out;
}

function findLine(text, needle) {
  const idx = String(text).indexOf(String(needle));
  if (idx < 0) return null;
  return String(text).slice(0, idx).split(/\r?\n/).length;
}

function extractRulePaths(obj, prefix = '') {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('.')) continue;
    const p = prefix ? `${prefix}/${key}` : key;
    out.push(p);
    out.push(...extractRulePaths(value, p));
  }
  return out.slice(0, 200);
}
