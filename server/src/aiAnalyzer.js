import { DEFAULT_AI_MODEL, DEFAULT_AI_PROVIDER, MAX_AI_CORPUS_CHARS } from './config.js';
import { getAiSettings, getSecretValue, saveScan } from './store.js';
import { loadRepository } from './scanner/repoLoader.js';

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    secret: 'AI_KEY_OPENAI',
    env: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4.1-mini',
    mode: 'openai_responses',
    url: 'https://api.openai.com/v1/responses'
  },
  gemini: {
    label: 'Google Gemini',
    secret: 'AI_KEY_GEMINI',
    env: 'GEMINI_API_KEY',
    defaultModel: 'gemini-1.5-flash',
    mode: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
  },
  groq: {
    label: 'Groq',
    secret: 'AI_KEY_GROQ',
    env: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    mode: 'openai_chat',
    url: 'https://api.groq.com/openai/v1/chat/completions'
  },
  openrouter: {
    label: 'OpenRouter',
    secret: 'AI_KEY_OPENROUTER',
    env: 'OPENROUTER_API_KEY',
    defaultModel: 'deepseek/deepseek-chat-v3.1:free',
    mode: 'openai_chat',
    url: 'https://openrouter.ai/api/v1/chat/completions'
  },
  mistral: {
    label: 'Mistral',
    secret: 'AI_KEY_MISTRAL',
    env: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-small-latest',
    mode: 'openai_chat',
    url: 'https://api.mistral.ai/v1/chat/completions'
  }
};

const PRICE_USD_PER_1M = {
  // Schätzwerte für Kosten-Vorschau. Tatsächliche Preise immer beim Anbieter prüfen.
  openai: [
    { match: /nano/i, input: 0.20, output: 1.25 },
    { match: /mini/i, input: 0.75, output: 4.50 },
    { match: /gpt-4\.1-mini/i, input: 0.40, output: 1.60 },
    { match: /gpt-4o-mini/i, input: 0.15, output: 0.60 },
    { match: /gpt-4|gpt-5/i, input: 2.50, output: 15.00 }
  ]
};

export function getAiProviders() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([key, p]) => [key, {
    label: p.label,
    defaultModel: p.defaultModel,
    mode: p.mode
  }]));
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    purpose: { type: 'string' },
    confidence: { type: 'number' },
    projectGroup: { type: 'string', enum: ['chiefcards','chiefbaliman','quizt-laura','infrastruktur','privat','unsortiert'] },
    summary: { type: 'string' },
    architecture: { type: 'array', items: { type: 'string' } },
    mainFeatures: { type: 'array', items: { type: 'string' } },
    dataModel: { type: 'array', items: { type: 'string' } },
    externalServices: { type: 'array', items: { type: 'string' } },
    firebase: {
      type: 'object',
      additionalProperties: false,
      properties: {
        usesFirebase: { type: 'boolean' },
        projectIds: { type: 'array', items: { type: 'string' } },
        fixedPaths: { type: 'array', items: { type: 'string' } },
        dynamicPaths: { type: 'array', items: { type: 'string' } },
        explanation: { type: 'string' }
      },
      required: ['usesFirebase','projectIds','fixedPaths','dynamicPaths','explanation']
    },
    risks: { type: 'array', items: { type: 'string' } },
    guardrails: { type: 'array', items: { type: 'string' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          finding: { type: 'string' },
          snippet: { type: 'string' }
        },
        required: ['file','line','finding','snippet']
      }
    },
    chatgptContext: { type: 'string' }
  },
  required: ['purpose','confidence','projectGroup','summary','architecture','mainFeatures','dataModel','externalServices','firebase','risks','guardrails','nextSteps','evidence','chatgptContext']
};

export async function estimateAiAnalysis(fullName, currentScan = null, options = {}) {
  const settings = getAiSettings();
  const providerKey = normalizeProvider(options.provider || settings.provider || DEFAULT_AI_PROVIDER);
  const provider = PROVIDERS[providerKey];
  const model = String(options.model || settings.models?.[providerKey] || DEFAULT_AI_MODEL || provider.defaultModel).trim() || provider.defaultModel;
  const mode = normalizeMode(options.mode);
  const loaded = await loadRepository(fullName);
  const selected = selectContentsForMode(loaded, currentScan, mode);
  const corpus = buildCorpus(loaded, selected.contents);
  const staticFacts = buildStaticSummary(currentScan, loaded);
  const prompt = buildPrompt(fullName, loaded, currentScan, corpus, staticFacts, { mode, previousAi: currentScan?.ai || null, changed: selected });
  const inputChars = prompt.system.length + prompt.user.length;
  const inputTokensEstimated = Math.ceil(inputChars / 3.8);
  const outputTokensEstimated = Math.max(1800, Math.min(9000, Math.ceil(inputTokensEstimated * 0.08)));
  const pricing = lookupPricing(providerKey, model);
  const estimatedCostUsd = pricing ? ((inputTokensEstimated / 1_000_000) * pricing.input + (outputTokensEstimated / 1_000_000) * pricing.output) : null;
  const current = Boolean(currentScan?.ai?.contentFingerprint && currentScan?.contentFingerprint && currentScan.ai.contentFingerprint === currentScan.contentFingerprint);
  return {
    provider: providerKey,
    providerLabel: provider.label,
    model,
    mode,
    current,
    lastAnalyzedAt: currentScan?.ai?.analyzedAt || null,
    contentFingerprint: currentScan?.contentFingerprint || null,
    aiFingerprint: currentScan?.ai?.contentFingerprint || null,
    filesTotal: loaded.inventory.totalFiles,
    filesRead: loaded.inventory.readFiles,
    filesIncluded: corpus.includedFiles.length,
    changedFiles: selected.changedFiles,
    deletedFiles: selected.deletedFiles,
    corpusChars: corpus.totalChars,
    truncated: corpus.truncated,
    inputTokensEstimated,
    outputTokensEstimated,
    estimatedCostUsd,
    estimatedCostLabel: estimatedCostUsd == null ? 'nicht berechnet' : `$${estimatedCostUsd.toFixed(4)}`,
    pricingNote: pricing ? 'Schätzung anhand Token-Näherung. Tatsächliche API-Kosten können leicht abweichen.' : 'Für diesen Anbieter ist keine verlässliche Kostenschätzung hinterlegt.'
  };
}

export async function runAiAnalysis(fullName, currentScan = null, options = {}) {
  const settings = getAiSettings();
  const providerKey = normalizeProvider(options.provider || settings.provider || DEFAULT_AI_PROVIDER);
  const provider = PROVIDERS[providerKey];
  const model = String(options.model || settings.models?.[providerKey] || DEFAULT_AI_MODEL || provider.defaultModel).trim() || provider.defaultModel;
  const mode = normalizeMode(options.mode);
  const apiKey = getProviderKey(providerKey, provider);
  if (!apiKey) {
    throw new Error(`Kein API Key für ${provider.label} gespeichert. Bitte links im Bereich KI-Anbieter speichern.`);
  }

  const loaded = await loadRepository(fullName);
  const selected = selectContentsForMode(loaded, currentScan, mode);
  if (mode === 'changed' && currentScan?.ai && selected.contents.length === 0) {
    return { ...currentScan.ai, reused:true, reuseReason:'Keine geänderten Dateien seit der letzten KI-Analyse.' };
  }
  const corpus = buildCorpus(loaded, selected.contents);
  const staticFacts = buildStaticSummary(currentScan, loaded);
  const prompt = buildPrompt(fullName, loaded, currentScan, corpus, staticFacts, { mode, previousAi: currentScan?.ai || null, changed: selected });

  const startedAt = new Date().toISOString();
  const raw = await callProvider({ providerKey, provider, model, apiKey, prompt });
  const outputText = extractProviderText(providerKey, raw);
  const ai = parseAiJson(outputText);

  const result = normalizeAiResult(ai, {
    providerKey,
    providerLabel: provider.label,
    model,
    startedAt,
    fullName,
    loaded,
    corpus,
    mode,
    selected,
    contentFingerprint: currentScan?.contentFingerprint || null
  });

  if (currentScan) {
    applyAiResultToScan(currentScan, result);
    saveScan(fullName, currentScan);
  }

  return result;
}

function normalizeProvider(p) {
  const key = String(p || '').toLowerCase().trim();
  return PROVIDERS[key] ? key : 'gemini';
}

function getProviderKey(providerKey, provider) {
  const legacyOpenAi = providerKey === 'openai' ? (getSecretValue('OPENAI_API_KEY') || getSecretValue('openai_api_key')) : '';
  return process.env[provider.env] || getSecretValue(provider.secret) || legacyOpenAi || '';
}

async function callProvider({ providerKey, provider, model, apiKey, prompt }) {
  if (provider.mode === 'openai_responses') {
    return callOpenAiResponses({ provider, model, apiKey, prompt });
  }
  if (provider.mode === 'gemini') {
    return callGemini({ provider, model, apiKey, prompt });
  }
  return callOpenAiChatCompatible({ providerKey, provider, model, apiKey, prompt });
}

async function callOpenAiResponses({ provider, model, apiKey, prompt }) {
  const response = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: prompt.system }] },
        { role: 'user', content: [{ type: 'input_text', text: prompt.user }] }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'developer_hub_project_analysis',
          schema: ANALYSIS_SCHEMA,
          strict: true
        }
      }
    })
  });
  return readProviderResponse(response, 'OpenAI');
}

async function callGemini({ provider, model, apiKey, prompt }) {
  const url = provider.url.replace('{model}', encodeURIComponent(model)) + `?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    })
  });
  return readProviderResponse(response, 'Gemini');
}

async function callOpenAiChatCompatible({ providerKey, provider, model, apiKey, prompt }) {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  if (providerKey === 'openrouter') {
    headers['HTTP-Referer'] = 'https://chief-developer-hub.local';
    headers['X-Title'] = 'Chief Developer Hub';
  }
  const response = await fetch(provider.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ]
    })
  });
  return readProviderResponse(response, provider.label);
}

async function readProviderResponse(response, label) {
  const rawText = await response.text();
  let raw;
  try { raw = rawText ? JSON.parse(rawText) : null; } catch { raw = rawText; }
  if (!response.ok) {
    const msg = raw?.error?.message || raw?.message || rawText || `${label} Fehler ${response.status}`;
    throw new Error(msg);
  }
  return raw;
}

function buildPrompt(fullName, loaded, scan, corpus, staticFacts, options = {}) {
  const system = `Du bist ein erfahrener Senior-Softwarearchitekt und Code-Reviewer. Analysiere das Repository wirklich anhand des gelieferten Codes. Du darfst den Zweck nicht aus Repository-Name oder Firebase-Projekt-ID ableiten. Eine Firebase-Projekt-ID wie queue-tracker kann mehrere Tools enthalten. Nutze nur Code, UI-Texte, Datenpfade, Funktionen, Routen, Imports und Datei-Inhalte als Belege. Wenn etwas unsicher ist, schreibe das klar. Antworte ausschließlich mit einem einzigen gültigen JSON-Objekt. Keine Markdown-Ausgabe. Keine Erklärungen außerhalb des JSON. Das JSON muss diese Felder enthalten: purpose, confidence, projectGroup, summary, architecture, mainFeatures, dataModel, externalServices, firebase, risks, guardrails, nextSteps, evidence, chatgptContext.`;
  const user = `Repository: ${fullName}\n\nGitHub-Metadaten:\n${JSON.stringify(loaded.repo, null, 2)}\n\nStatische Voranalyse des Hubs:\n${JSON.stringify(staticFacts, null, 2)}\n\nWichtige Trennungsregel:\nQuizt ist ein externes Projekt für Laura und darf nicht als ChiefCards-Projekt einsortiert werden. ChiefCards, ChiefBaliman, Quizt/Laura und Infrastruktur getrennt halten.\n\nAufgabe:\n1. Bestimme den echten Projektzweck anhand des Codes.\n2. Erkenne Architektur, Hauptfunktionen, Datenmodell und externe Dienste.\n3. Erkläre Firebase-Nutzung. Projekt-ID ist nur Ressource, nicht Zweck.\n4. Nenne konkrete Belege mit Datei, Zeile und Snippet.\n5. Erstelle einen ChatGPT-Kontext, mit dem ein neuer Chat das Projekt weiterentwickeln kann.\n\nErforderliches JSON-Format:\n${JSON.stringify(buildJsonExample(), null, 2)}\n\nGelesener Code-Korpus (${corpus.totalChars} Zeichen, ${corpus.includedFiles.length} Dateien, gekürzt: ${corpus.truncated ? 'ja' : 'nein'}):\n\n${corpus.text}`;
  return { system, user };
}

function buildJsonExample() {
  return {
    purpose: 'Konkreter Projektzweck anhand des Codes',
    confidence: 0.82,
    projectGroup: 'unsortiert',
    summary: 'Kurze technische Zusammenfassung',
    architecture: ['Architekturpunkt mit Belegbezug'],
    mainFeatures: ['Funktion 1', 'Funktion 2'],
    dataModel: ['Datenstruktur oder Pfad'],
    externalServices: ['GitHub Pages', 'Firebase Realtime Database'],
    firebase: {
      usesFirebase: false,
      projectIds: [],
      fixedPaths: [],
      dynamicPaths: [],
      explanation: 'Erklärung der Firebase-Nutzung oder keine Firebase-Nutzung erkannt.'
    },
    risks: ['Risiko oder keine'],
    guardrails: ['Regel für künftige Änderungen'],
    nextSteps: ['Sinnvoller nächster Schritt'],
    evidence: [{ file: 'index.html', line: 1, finding: 'Was wurde gefunden', snippet: 'Kurzer Codeauszug' }],
    chatgptContext: 'Fertiger Kontext für einen neuen Chat'
  };
}

function buildStaticSummary(scan, loaded) {
  return {
    scannerVersion: scan?.scannerVersion || null,
    inventory: loaded.inventory,
    staticPurpose: scan?.purpose || null,
    staticScores: scan?.scores || [],
    staticResources: scan?.resources || [],
    staticFactsTop: (scan?.facts || []).slice(0, 120),
    staticAnalyses: scan?.analyses || null
  };
}

function buildCorpus(loaded, selectedContents = null) {
  const maxChars = MAX_AI_CORPUS_CHARS;
  const files = (selectedContents || loaded.contents).slice().sort((a,b) => importance(b) - importance(a));
  const parts = [];
  const includedFiles = [];
  let used = 0;
  let truncated = false;

  for (const f of files) {
    const cleaned = maskSecrets(f.text);
    const numbered = addLineNumbers(cleaned);
    const header = `\n\n===== FILE: ${f.path} | language=${f.language} | lines=${f.lines} | bytes=${f.size} =====\n`;
    const block = header + numbered;
    if (used + block.length > maxChars) {
      const remaining = maxChars - used - header.length - 200;
      if (remaining > 800) {
        parts.push(header + numbered.slice(0, remaining) + `\n[GEKÜRZT: Datei wurde wegen Kontextlimit abgeschnitten]`);
        includedFiles.push({ path:f.path, partial:true });
        used = maxChars;
      }
      truncated = true;
      break;
    }
    parts.push(block);
    includedFiles.push({ path:f.path, partial:false });
    used += block.length;
  }
  return { text: parts.join(''), includedFiles, totalChars: parts.join('').length, truncated };
}

function importance(file) {
  const p = file.path.toLowerCase();
  let s = 0;
  if (/package\.json$|firebase\.json$|database\.rules|\.rules$|\.env\.example$|readme\.md$/.test(p)) s += 50;
  if (/index\.html$|app\.(js|ts)$|main\.(js|ts)$|server\/.+\.(js|ts)$|src\/.+\.(js|ts)$/.test(p)) s += 40;
  if (/\.js$|\.ts$|\.jsx$|\.tsx$|\.html$/.test(p)) s += 20;
  if (/test|spec|lock|package-lock/.test(p)) s -= 30;
  return s;
}

function addLineNumbers(text) {
  return text.split(/\r?\n/).map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`).join('\n');
}

function maskSecrets(text) {
  return String(text)
    .replace(/(gh[pousr]_[A-Za-z0-9_]{20,})/g, '[MASKED_GITHUB_TOKEN]')
    .replace(/(sk-[A-Za-z0-9_-]{20,})/g, '[MASKED_OPENAI_KEY]')
    .replace(/(AIza[0-9A-Za-z\-_]{20,})/g, '[MASKED_GOOGLE_OR_FIREBASE_KEY]')
    .replace(/(xox[baprs]-[A-Za-z0-9-]{20,})/g, '[MASKED_SLACK_TOKEN]')
    .replace(/(bot[0-9]{6,}:[A-Za-z0-9_-]{20,})/gi, '[MASKED_TELEGRAM_TOKEN]')
    .replace(/(-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]+?-----END [^-]+ PRIVATE KEY-----)/g, '[MASKED_PRIVATE_KEY]');
}

function normalizeMode(mode) {
  return String(mode || 'full').toLowerCase() === 'changed' ? 'changed' : 'full';
}

function buildFileHashes(loaded) {
  return Object.fromEntries((loaded.inventory?.files || []).filter(f => f.read && f.hash).map(f => [f.path, f.hash]));
}

function selectContentsForMode(loaded, currentScan, mode) {
  const currentHashes = buildFileHashes(loaded);
  const previousHashes = currentScan?.ai?.fileHashes || {};
  if (mode !== 'changed' || !currentScan?.ai || !Object.keys(previousHashes).length) {
    return { contents: loaded.contents, changedFiles: [], deletedFiles: [], fileHashes: currentHashes, mode:'full' };
  }
  const changedPaths = [];
  for (const f of loaded.contents) {
    if (previousHashes[f.path] !== f.hash) changedPaths.push(f.path);
  }
  const currentPathSet = new Set(Object.keys(currentHashes));
  const deletedFiles = Object.keys(previousHashes).filter(p => !currentPathSet.has(p));
  return {
    contents: loaded.contents.filter(f => changedPaths.includes(f.path)),
    changedFiles: changedPaths,
    deletedFiles,
    fileHashes: currentHashes,
    mode:'changed'
  };
}

function lookupPricing(providerKey, model) {
  const rows = PRICE_USD_PER_1M[providerKey];
  if (!rows) return null;
  const m = String(model || '');
  return rows.find(r => r.match.test(m)) || rows[rows.length - 1] || null;
}

function extractProviderText(providerKey, data) {
  if (providerKey === 'openai') {
    if (typeof data?.output_text === 'string') return data.output_text;
    const chunks = [];
    for (const item of data?.output || []) {
      for (const content of item.content || []) {
        if (typeof content.text === 'string') chunks.push(content.text);
      }
    }
    return chunks.join('\n').trim();
  }
  if (providerKey === 'gemini') {
    return data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n').trim() || '';
  }
  return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
}

function parseAiJson(outputText) {
  if (!outputText) throw new Error('KI hat keinen Text zurückgegeben.');
  const cleaned = String(outputText).trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (e) {
      throw new Error(`KI-Antwort konnte nicht als JSON gelesen werden: ${e.message}`);
    }
  }
  throw new Error('KI-Antwort enthält kein gültiges JSON-Objekt.');
}

function normalizeAiResult(ai, meta) {
  return {
    purpose: String(ai.purpose || 'Nicht sicher erkannt.'),
    confidence: Math.max(0, Math.min(1, Number(ai.confidence || 0))),
    projectGroup: ['chiefcards','chiefbaliman','quizt-laura','infrastruktur','privat','unsortiert'].includes(ai.projectGroup) ? ai.projectGroup : 'unsortiert',
    summary: String(ai.summary || ''),
    architecture: arr(ai.architecture),
    mainFeatures: arr(ai.mainFeatures),
    dataModel: arr(ai.dataModel),
    externalServices: arr(ai.externalServices),
    firebase: {
      usesFirebase: Boolean(ai.firebase?.usesFirebase),
      projectIds: arr(ai.firebase?.projectIds),
      fixedPaths: arr(ai.firebase?.fixedPaths),
      dynamicPaths: arr(ai.firebase?.dynamicPaths),
      explanation: String(ai.firebase?.explanation || '')
    },
    risks: arr(ai.risks),
    guardrails: arr(ai.guardrails),
    nextSteps: arr(ai.nextSteps),
    evidence: (Array.isArray(ai.evidence) ? ai.evidence : []).slice(0, 40).map(e => ({
      file: String(e.file || ''),
      line: Number.isFinite(Number(e.line)) ? Number(e.line) : 1,
      finding: String(e.finding || ''),
      snippet: String(e.snippet || '').slice(0, 500)
    })),
    chatgptContext: String(ai.chatgptContext || ''),
    provider: meta.providerKey,
    providerLabel: meta.providerLabel,
    model: meta.model,
    analyzedAt: new Date().toISOString(),
    startedAt: meta.startedAt,
    repoFullName: meta.fullName,
    inputStats: {
      filesTotal: meta.loaded.inventory.totalFiles,
      filesRead: meta.loaded.inventory.readFiles,
      corpusChars: meta.corpus.totalChars,
      includedFiles: meta.corpus.includedFiles.length,
      truncated: meta.corpus.truncated,
      mode: meta.mode || 'full',
      changedFiles: meta.selected?.changedFiles || [],
      deletedFiles: meta.selected?.deletedFiles || []
    },
    contentFingerprint: meta.contentFingerprint || null,
    fileHashes: meta.selected?.fileHashes || buildFileHashes(meta.loaded)
  };
}

function arr(x) {
  return Array.isArray(x) ? x.map(v => String(v)).filter(Boolean) : [];
}

function applyAiResultToScan(currentScan, result) {
  currentScan.ai = result;
  currentScan.purpose = {
    text: result.purpose,
    confidence: result.confidence,
    evidence: (result.evidence || []).slice(0, 20).map(e => ({
      category: 'ai',
      type: 'evidence',
      file: e.file,
      line: e.line,
      value: e.finding,
      snippet: e.snippet,
      strength: 5,
      reason: `${result.providerLabel} KI-Analyse auf Basis des gelesenen Codes.`
    }))
  };
  currentScan.projectGroup = result.projectGroup || currentScan.projectGroup;
  currentScan.architecture = mergeUnique(result.architecture || [], currentScan.architecture || []);
  currentScan.guardrails = mergeUnique(result.guardrails || [], currentScan.guardrails || []);
  currentScan.chatgptContext = result.chatgptContext || currentScan.chatgptContext;
  currentScan.wiki = buildAiWiki(currentScan, result);
}

function mergeUnique(a, b) {
  return [...new Set([...(a || []), ...(b || [])].filter(Boolean))];
}

function buildAiWiki(scan, ai) {
  const lines = [];
  lines.push(`# ${scan.repo.fullName}`);
  lines.push('');
  lines.push(`KI-Analyse: ${ai.providerLabel || ai.provider} / ${ai.model} am ${ai.analyzedAt}`);
  lines.push(`Scanner: ${scan.scannerVersion}`);
  lines.push('');
  lines.push('## Zweck');
  lines.push(ai.purpose || 'Nicht erkannt.');
  lines.push('');
  lines.push('## Zusammenfassung');
  lines.push(ai.summary || '');
  lines.push('');
  lines.push('## Architektur');
  for (const item of ai.architecture || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Hauptfunktionen');
  for (const item of ai.mainFeatures || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Datenmodell');
  for (const item of ai.dataModel || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Firebase');
  lines.push(ai.firebase?.explanation || 'Keine Firebase-Information.');
  lines.push('');
  lines.push('## Externe Dienste');
  for (const item of ai.externalServices || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Risiken');
  for (const item of ai.risks || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Guardrails');
  for (const item of ai.guardrails || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Belege');
  for (const e of ai.evidence || []) lines.push(`- ${e.file}:${e.line} - ${e.finding}`);
  return lines.join('\n');
}
