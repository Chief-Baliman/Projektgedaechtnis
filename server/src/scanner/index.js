import { loadRepository } from './repoLoader.js';
import { analyzeJavaScript } from './jsAnalyzer.js';
import { analyzeHtml } from './htmlAnalyzer.js';
import { analyzeJson } from './jsonAnalyzer.js';
import { analyzeCss } from './cssAnalyzer.js';
import { classifyProject } from './classifier.js';
import { generateWiki, generateContext } from './generators.js';
import { addFact, countWords, sha256, unique } from './utils.js';

export const SCANNER_VERSION = 'scanner-engine-v6.0-real-code-facts';

export async function scanRepository(fullName) {
  const loaded = await loadRepository(fullName);
  const ctx = { facts: [] };

  addFact(ctx.facts, {
    category: 'repo', type: 'metadata', file: 'GitHub API', value: loaded.repo.fullName,
    strength: 1, reason: 'Repository-Metadaten gelesen.'
  });

  const analyses = {};
  analyses.js = analyzeJavaScript(loaded.contents, ctx);
  analyses.html = analyzeHtml(loaded.contents, ctx);
  analyses.json = analyzeJson(loaded.contents, ctx);
  analyses.css = analyzeCss(loaded.contents, ctx);

  const allText = loaded.contents.map(f => f.text).join('\n');
  const topTerms = countWords(allText);
  for (const term of topTerms.slice(0, 25)) {
    addFact(ctx.facts, { category: 'terms', type: 'top_term', value: `${term.word} (${term.count})`, strength: term.count > 10 ? 2 : 1, reason: 'Häufiger Code-/UI-Begriff im Repository.' });
  }

  const classification = classifyProject({ repo: loaded.repo, facts: ctx.facts, analyses, contents: loaded.contents });
  const fingerprint = sha256(JSON.stringify({ files: loaded.inventory.files.map(f => [f.path, f.sha, f.size]), facts: ctx.facts.map(f => [f.category, f.type, f.value, f.file, f.line]) }));

  const analysis = {
    scannerVersion: SCANNER_VERSION,
    scannedAt: new Date().toISOString(),
    contentFingerprint: fingerprint,
    repo: loaded.repo,
    projectGroup: classification.projectGroup,
    inventory: loaded.inventory,
    purpose: classification.purpose,
    scores: classification.scores,
    conflicts: classification.conflicts,
    architecture: classification.architecture,
    resources: classification.resources,
    guardrails: classification.guardrails,
    facts: ctx.facts.sort((a,b) => (b.strength || 0) - (a.strength || 0)),
    analyses: compactAnalyses(analyses),
    debug: buildDebug(loaded, analyses, ctx.facts, classification),
    wiki: '',
    chatgptContext: ''
  };
  analysis.wiki = generateWiki(analysis);
  analysis.chatgptContext = generateContext(analysis);
  return analysis;
}

function compactAnalyses(analyses) {
  return {
    js: {
      imports: analyses.js.imports.slice(0, 100),
      requires: analyses.js.requires.slice(0, 80),
      functions: analyses.js.functions.slice(0, 300),
      classes: analyses.js.classes.slice(0, 100),
      routes: analyses.js.routes.slice(0, 100),
      firebase: analyses.js.firebase,
      strings: analyses.js.strings.slice(0, 180),
      errors: analyses.js.errors
    },
    html: analyses.html,
    json: analyses.json,
    css: { files: analyses.css.files, selectors: analyses.css.selectors.slice(0, 250) }
  };
}

function buildDebug(loaded, analyses, facts, classification) {
  return {
    proof: 'Dieser Scan liest den GitHub Tree, lädt Textdateien per Blob-API, parst JS/TS mit Babel, HTML mit htmlparser2 und JSON mit JSON.parse. Die untenstehenden Belege kommen aus Dateien, Zeilen und Snippets.',
    scannerVersion: SCANNER_VERSION,
    fileReadSummary: {
      totalFiles: loaded.inventory.totalFiles,
      readFiles: loaded.inventory.readFiles,
      bytesRead: loaded.inventory.totalBytesRead,
      languages: loaded.inventory.languageCounts
    },
    readFiles: loaded.inventory.files.filter(f => f.read).map(f => ({ path:f.path, language:f.language, size:f.size, lines:f.lines, hash:f.hash })).slice(0, 500),
    skippedFiles: loaded.inventory.skipped,
    parserSummary: {
      jsFunctions: analyses.js.functions.length,
      jsClasses: analyses.js.classes.length,
      jsImports: analyses.js.imports.length + analyses.js.requires.length,
      apiRoutes: analyses.js.routes.length,
      firebaseRefs: analyses.js.firebase.refs.length,
      htmlFiles: analyses.html.files.length,
      jsonFiles: analyses.json.jsonFiles.length,
      cssFiles: analyses.css.files.length,
      parseErrors: analyses.js.errors.length + analyses.json.errors.length
    },
    scores: classification.scores.map(s => ({ domain:s.domain, label:s.label, score:s.score, evidence:s.evidence.slice(0, 8) })),
    topFacts: facts.slice().sort((a,b) => (b.strength || 0) - (a.strength || 0)).slice(0, 120)
  };
}
