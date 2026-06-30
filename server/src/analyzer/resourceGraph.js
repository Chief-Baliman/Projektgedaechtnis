import { uniq } from './utils.js';
export function inferFirebase(facts) {
  const projectIds = uniq(facts.filter(f => ['firebase.config.projectId','firebase.projectId'].includes(f.kind)).map(f=>f.match));
  const dbUrls = uniq(facts.filter(f => ['firebase.config.databaseURL','firebase.databaseURL'].includes(f.kind)).map(f=>f.match));
  const refs = facts.filter(f => ['firebase.ref.ast','firebase.ref.static','firebase.ref.dynamic'].includes(f.kind));
  const paths = uniq(refs.filter(f => f.details?.static || !/[`$+{}\[\]]/.test(f.match)).map(f=>String(f.match).replace(/^['"`]|['"`]$/g,''))).slice(0,120);
  const dynamicPaths = uniq(refs.filter(f => !f.details?.static && /[`$+{}\[\]]/.test(f.match)).map(f=>f.match)).slice(0,120);
  const operations = uniq(facts.filter(f => f.kind.startsWith('firebase.operation')).map(f=>f.match)).slice(0,40);
  const rules = uniq(facts.filter(f => f.kind.startsWith('rules.')).map(f=>`${f.file}:${f.line} ${f.match}`)).slice(0,80);
  return { detected:Boolean(projectIds.length || dbUrls.length || refs.length || operations.length || rules.length), projectIds, dbUrls, paths, dynamicPaths, operations, rules };
}
export function inferRoutes(facts) { return uniq(facts.filter(f => f.kind.startsWith('api.')).map(f=>f.match)).slice(0,120); }
export function inferFunctions(facts) { return uniq(facts.filter(f => f.kind === 'js.function').map(f=>f.match)).slice(0,200); }
export function inferImports(facts) { return uniq(facts.filter(f => f.kind === 'js.import').map(f=>f.match)).slice(0,200); }
export function inferUiTexts(facts) { return uniq(facts.filter(f => f.kind.startsWith('html.') || f.kind.startsWith('dom.')).map(f=>f.match)).slice(0,200); }
export function inferTech(inventory, facts, repo) {
  const tech=[]; const lang=inventory.byLanguage||{};
  if(lang.html) tech.push('HTML'); if(lang.javascript) tech.push('JavaScript'); if(lang.typescript) tech.push('TypeScript'); if(lang.python) tech.push('Python'); if(lang.json) tech.push('JSON');
  if(facts.some(f=>f.kind.startsWith('firebase.'))) tech.push('Firebase');
  if(facts.some(f=>f.kind.startsWith('api.express'))) tech.push('Express/API');
  if(facts.some(f=>f.match==='playwright' || /playwright/i.test(f.snippet))) tech.push('Playwright');
  if(repo.hasPages) tech.push('GitHub Pages');
  if(facts.some(f=>f.kind==='json.dependencies' && /react/i.test(f.match))) tech.push('React');
  return [...new Set(tech)];
}
export function buildArchitecture(inventory, facts, firebase, routes) {
  const out=[];
  if (inventory.fileCount === 1 && inventory.files.some(f=>/index\.html$/i.test(f.path))) out.push('Ein-Datei-App: index.html enthält vermutlich Oberfläche, Logik und Styles.');
  if (inventory.byLanguage.javascript || inventory.byLanguage.typescript) out.push('JavaScript/TypeScript-Code wurde ausgelesen und per AST analysiert.');
  if (firebase.detected) out.push('Firebase-Nutzung erkannt. Projekt-ID wird nur als Ressource behandelt, nicht als Projektzweck.');
  if (firebase.paths?.length) out.push(`Feste Firebase-Pfade erkannt: ${firebase.paths.slice(0,10).join(', ')}.`);
  if (firebase.dynamicPaths?.length) out.push(`Dynamische Firebase-Pfade erkannt: ${firebase.dynamicPaths.slice(0,8).join(', ')}.`);
  if (routes.length) out.push(`API-/Fetch-Routen erkannt: ${routes.slice(0,8).join(', ')}.`);
  return out;
}
