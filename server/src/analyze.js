import { ANALYZER_VERSION, limitReadable, uniq, topCounts } from './analyzer/utils.js';
import { buildInventory } from './analyzer/inventory.js';
import { collectRegexFacts } from './analyzer/regexFacts.js';
import { analyzeJavaScriptAst } from './analyzer/jsAst.js';
import { analyzeHtml } from './analyzer/htmlParser.js';
import { analyzeJson } from './analyzer/jsonParser.js';
import { analyzeFirebaseRules } from './analyzer/firebaseRules.js';
import { classifyProject, inferPurpose, inferProjectSpace, conflicts as inferConflicts } from './analyzer/classifier.js';
import { inferFirebase, inferRoutes, inferFunctions, inferImports, inferUiTexts, inferTech, buildArchitecture } from './analyzer/resourceGraph.js';
import { buildDebug, buildWiki, buildGuardrails, health, detectSecrets } from './analyzer/report.js';
export { limitReadable };

function enrichFacts(facts) {
  const seen = new Set();
  return facts.filter(f => {
    const key = `${f.kind}|${f.file}|${f.line}|${f.match}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b) => String(a.file).localeCompare(String(b.file)) || a.line-b.line).slice(0, 5000);
}

function projectRelations(fullName, projectSpace, firebase, allKnownProjects = []) {
  return (allKnownProjects || []).filter(p => p.fullName !== fullName).map(p => {
    const pIds = p.analysis?.firebase?.projectIds || [];
    const sameFirebase = pIds.some(id => (firebase.projectIds || []).includes(id));
    const sameSpace = p.analysis?.projectSpace?.key && p.analysis.projectSpace.key === projectSpace.key;
    if (!sameFirebase && !sameSpace) return null;
    return { fullName:p.fullName, reason:sameFirebase?'teilt Firebase-Ressource':'gleiche Projektwelt', space:p.analysis?.projectSpace?.name || 'Unbekannt', hardDependency:sameFirebase };
  }).filter(Boolean);
}

function codeInsights(facts, inventory, classification, debug) {
  return {
    domains: classification.ranked.map(d => `${d.key}:${d.score}`),
    topSignals: classification.signals,
    functions: inferFunctions(facts),
    imports: inferImports(facts),
    uiLabels: inferUiTexts(facts),
    codeFacts: facts.slice(0,250),
    fileSummaries: debug.topFilesByFacts.slice(0,60).map(f => `${f.path}: ${f.lines} Zeilen, ${f.factCount} Fakten, ${f.language}`),
    inventory: inventory.files.slice(0,300),
    debug
  };
}

export function analyzeRepository(repo, files, allKnownProjects = []) {
  const safeFiles = (files || []).map(f => ({ ...f, content: String(f.content || '') }));
  const inventory = buildInventory(safeFiles);
  let facts = [];
  facts.push(...collectRegexFacts(safeFiles));
  facts.push(...analyzeJavaScriptAst(safeFiles));
  facts.push(...analyzeHtml(safeFiles));
  facts.push(...analyzeJson(safeFiles));
  facts.push(...analyzeFirebaseRules(safeFiles));
  facts = enrichFacts(facts);
  const classification = classifyProject(repo, facts);
  const purpose = inferPurpose(classification, facts);
  const projectSpace = inferProjectSpace(repo, classification);
  const firebase = inferFirebase(facts);
  const routes = inferRoutes(facts);
  const functions = inferFunctions(facts);
  const imports = inferImports(facts);
  const uiTexts = inferUiTexts(facts);
  const tech = inferTech(inventory, facts, repo);
  const architecture = buildArchitecture(inventory, facts, firebase, routes);
  const conflicts = inferConflicts(repo, classification, firebase);
  const relatedProjects = projectRelations(repo.fullName, projectSpace, firebase, allKnownProjects);
  const sharedFirebase = relatedProjects.filter(r => r.hardDependency).map(r => ({ fullName:r.fullName, space:r.space }));
  const secrets = detectSecrets(safeFiles);
  const todos = facts.filter(f => f.kind === 'todo').map(f => `${f.file}:${f.line} ${f.match}`).slice(0,60);
  const debug = buildDebug(facts, inventory, classification);
  const wiki = buildWiki({ repo, purpose, tech, firebase:{...firebase, sharedWith:sharedFirebase}, routes, functions, imports, uiTexts, architecture, projectSpace, conflicts, debug });
  const scanQuality = {
    confidence: classification.confidence,
    topDomain: classification.topDomain,
    topDomainScore: classification.topScore,
    secondDomain: classification.secondDomain,
    secondDomainScore: classification.secondScore,
    extractedSignals: facts.length,
    filesRead: inventory.fileCount,
    codeFilesRead: inventory.codeFiles,
    totalLines: inventory.totalLines,
    fingerprint: inventory.fingerprint
  };
  const sourceAudit = {
    repo: repo.fullName,
    filesRequested: safeFiles.length,
    filesWithContent: inventory.files.filter(f=>f.bytes>0).length,
    codeFilesWithContent: inventory.codeFiles,
    totalBytes: inventory.totalBytes,
    totalLines: inventory.totalLines,
    contentFingerprint: inventory.fingerprint,
    byLanguage: inventory.byLanguage,
    topFiles: debug.topFilesByFacts.slice(0,80)
  };
  return {
    analyzerVersion: ANALYZER_VERSION,
    repoName: repo.name,
    fullName: repo.fullName,
    purpose,
    defaultBranch: repo.defaultBranch,
    htmlUrl: repo.htmlUrl,
    pagesUrl: repo.hasPages ? `https://${repo.fullName.split('/')[0]}.github.io/${repo.name}/` : '',
    updatedAt: repo.updatedAt,
    fileCount: inventory.fileCount,
    scannedFiles: safeFiles.length,
    sourceAudit,
    inventory,
    tech,
    projectSpace,
    ownershipNotes: projectSpace.key === 'quizt'
      ? ['Quizt nicht als ChiefCards-Projekt behandeln.', 'Laura/Quizt ist organisatorisch getrennt.', 'ChiefCards-Kontext nur nutzen, wenn eine technische Ressource wirklich geteilt wird.']
      : ['Projektkontext aus Code und manuellen Notizen ableiten.', 'Geteilte Ressourcen immer prüfen.'],
    firebase: { ...firebase, sharedWith: sharedFirebase },
    bots: facts.filter(f => f.kind === 'domain.bot').slice(0,40),
    routes,
    dataModel: uniq([...firebase.paths, ...firebase.dynamicPaths, ...facts.filter(f=>f.kind==='js.object').map(f=>f.match)]).slice(0,120),
    codeInsights: codeInsights(facts, inventory, classification, debug),
    scanQuality,
    classification,
    conflicts,
    relatedProjects,
    hosting: repo.hasPages ? ['GitHub Pages aktiv'] : [],
    importantFiles: inventory.files.filter(f => /README|index|package|firebase|rules|app|main|server|bot|watcher|tracker/i.test(f.path)).map(f=>f.path).slice(0,120),
    architecture,
    secretWarnings: secrets,
    todos,
    health: health({ inventory, firebase, conflicts, classification, secrets, todos }),
    wiki,
    scannedAt: new Date().toISOString(),
    guardrails: buildGuardrails(projectSpace, firebase, classification)
  };
}
