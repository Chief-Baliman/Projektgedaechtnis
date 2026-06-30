import { unique } from './utils.js';

const DOMAINS = {
  queue: {
    label: 'Queue / Warteschlange',
    purpose: 'Verwaltung einer Warteschlange oder Bestellreihenfolge.',
    keywords: ['queue','warteschlange','bestellnummer','currentorder','nextorder','remainingorders','orderinput','queueTracker/state','nächste bestellung','oben einfügen'],
    forbiddenFromResourceOnly: ['queue-tracker-3fa3c']
  },
  offers: {
    label: 'Angebots-Tracker / Deal-Tool',
    purpose: 'Überwachung, Anzeige oder Verwaltung von Angeboten, Deals, Preisen oder Produkten.',
    keywords: ['angebot','angebote','deal','deals','offer','offers','price','preis','discount','rabatt','watchlist','product watcher','produkt','shop','verfügbarkeit','funtainment','playpublic','luminous']
  },
  quizt: {
    label: 'Quizt / Laura',
    purpose: 'Externes Quizt-Projekt für Laura, etwa Website, Punkte, Liga oder Eventverwaltung.',
    keywords: ['quizt','quiz','team','teams','runde','runden','punkte','score','liga','streetlife','moderator','eventcode','ranking']
  },
  grading: {
    label: 'Grading / PSA / Beckett',
    purpose: 'Tool rund um Grading, Einreichungen, Kartenbewertung oder Tracking von Slabs.',
    keywords: ['grading','grade','psa','beckett','bgs','slab','submission','cert','zertifikat','karte bewerten']
  },
  bot: {
    label: 'Bot / Automation',
    purpose: 'Bot oder Automatisierung, z. B. Telegram, Discord, Cron, Scraping oder Watcher.',
    keywords: ['telegram','telegraf','discord','bot','webhook','polling','cron','watcher','playwright','puppeteer','gunicorn','systemd']
  },
  flohmarkt: {
    label: 'Flohmarkt / Bestand / Preise',
    purpose: 'Verwaltung von Preisen, Bestand, Barcodes oder Flohmarkt-Artikeln.',
    keywords: ['flohmarkt','bestand','lager','preis','preise','barcode','scan','kasse','produktliste','csv import','stückzahl']
  },
  website: {
    label: 'Website / Landingpage',
    purpose: 'Öffentliche Website oder Landingpage.',
    keywords: ['landingpage','hero','section','kontakt','impressum','datenschutz','website','homepage','navigation']
  },
  devhub: {
    label: 'Developer Hub',
    purpose: 'Entwicklungszentrale, Scanner, Deployment oder Projektgedächtnis.',
    keywords: ['developer hub','projektgedächtnis','scanner','deploy','rollback','github token','scan debug','context generator']
  }
};

export function classifyProject({ repo, facts, analyses, contents }) {
  const evidence = {};
  for (const key of Object.keys(DOMAINS)) evidence[key] = [];

  for (const fact of facts) {
    const hay = `${fact.value} ${fact.snippet} ${fact.reason} ${fact.file}`.toLowerCase();
    for (const [domain, def] of Object.entries(DOMAINS)) {
      for (const kw of def.keywords) {
        if (hay.includes(kw.toLowerCase())) {
          // Firebase project id "queue-tracker" is only a resource. It may not create queue purpose by itself.
          if (fact.category === 'resource' && def.forbiddenFromResourceOnly?.some(x => hay.includes(x.toLowerCase()))) continue;
          const weight = fact.strength || 1;
          evidence[domain].push({ ...fact, matched: kw, weight });
        }
      }
    }
  }

  // Repo name is weak evidence only.
  const repoName = `${repo.name} ${repo.fullName} ${repo.description || ''}`.toLowerCase();
  for (const [domain, def] of Object.entries(DOMAINS)) {
    for (const kw of def.keywords) {
      if (repoName.includes(kw.toLowerCase())) {
        evidence[domain].push({ category:'repo', type:'repo_name', value: repo.fullName, file:'GitHub Repository', line:null, snippet: repo.description || repo.name, reason:'Repo-Name/Beschreibung als schwacher Hinweis.', matched:kw, weight:1 });
      }
    }
  }

  const scores = Object.entries(evidence).map(([domain, ev]) => {
    const strongFileCount = new Set(ev.filter(e => e.category !== 'repo').map(e => e.file)).size;
    const score = ev.reduce((sum,e) => sum + (e.weight || 1), 0) + strongFileCount;
    return { domain, label: DOMAINS[domain].label, score, evidence: ev.sort((a,b) => (b.weight||0) - (a.weight||0)).slice(0, 12) };
  }).sort((a,b) => b.score - a.score);

  const best = scores[0];
  const second = scores[1];
  const confidence = confidenceFromScores(best?.score || 0, second?.score || 0);

  const conflicts = [];
  if (best && second && best.score > 0 && second.score > 0 && Math.abs(best.score - second.score) <= 5) {
    conflicts.push(`Projekt zeigt Signale für ${best.label} und ${second.label}. Bitte Debug prüfen.`);
  }
  if (/queue/i.test(repo.fullName) && best?.domain !== 'queue' && best?.score > 0) {
    conflicts.push('Repo-Name enthält Queue, Code-Signale zeigen aber etwas anderes. Repo-Name wird nicht als Zweck gewertet.');
  }
  if (/grading/i.test(repo.fullName) && best?.domain !== 'grading' && best?.score > 0) {
    conflicts.push('Repo-Name enthält Grading, Code-Signale zeigen aber etwas anderes oder sind zu schwach.');
  }

  const projectGroup = inferGroup(repo, scores);
  const purpose = buildPurpose(best, confidence, conflicts);

  return {
    scores,
    purpose,
    projectGroup,
    conflicts,
    architecture: inferArchitecture(analyses, facts),
    resources: buildResources(repo, analyses, facts),
    guardrails: buildGuardrails(projectGroup, analyses, best)
  };
}

function confidenceFromScores(best, second) {
  if (best <= 0) return 0;
  const gap = best - second;
  if (best >= 25 && gap >= 10) return 0.92;
  if (best >= 16 && gap >= 6) return 0.78;
  if (best >= 8 && gap >= 3) return 0.58;
  return 0.35;
}

function buildPurpose(best, confidence, conflicts) {
  if (!best || best.score <= 0 || confidence < 0.5) {
    return {
      text: 'Projektzweck nicht sicher erkannt. Der Hub zeigt unten die Code-Fakten, aus denen du die Einordnung prüfen kannst.',
      confidence,
      domain: 'unknown',
      label: 'Unklar',
      evidence: best?.evidence || []
    };
  }
  return {
    text: DOMAINS[best.domain].purpose,
    confidence,
    domain: best.domain,
    label: best.label,
    evidence: best.evidence || []
  };
}

function inferGroup(repo, scores) {
  const name = repo.fullName.toLowerCase();
  const top = scores[0]?.domain;
  if (top === 'quizt' || name.includes('quizt')) return 'quizt-laura';
  if (top === 'devhub' || name.includes('projektgedaechtnis') || name.includes('developer')) return 'infrastruktur';
  if (top === 'bot') return 'infrastruktur';
  if (name.includes('chiefcards') || top === 'offers' || top === 'queue' || top === 'grading' || top === 'flohmarkt') return 'chiefcards';
  return 'unsortiert';
}

function inferArchitecture(analyses, facts) {
  const items = [];
  if (analyses.js.imports.some(i => /express/.test(i.source)) || analyses.js.routes.length) items.push('Node/Express Backend erkannt');
  if (analyses.js.imports.some(i => /firebase/.test(i.source)) || facts.some(f => f.category === 'firebase')) items.push('Firebase Nutzung erkannt');
  if (facts.some(f => f.type === 'realtime_database')) items.push('Firebase Realtime Database erkannt');
  if (facts.some(f => f.type === 'firestore')) items.push('Firestore erkannt');
  if (analyses.html.files.length && !analyses.js.routes.length) items.push('Statische Web-App oder GitHub Pages möglich');
  if (analyses.json.packageJson.length) items.push('npm/Node Projektstruktur vorhanden');
  if (analyses.js.imports.some(i => /playwright|puppeteer/.test(i.source))) items.push('Browser-Automatisierung/Scraping erkannt');
  if (analyses.js.imports.some(i => /telegram|telegraf|discord/.test(i.source))) items.push('Bot-Integration erkannt');
  return unique(items);
}

function buildResources(repo, analyses, facts) {
  const resources = [];
  if (repo.htmlUrl) resources.push({ type:'github_repo', value: repo.fullName, label:'GitHub Repository', url: repo.htmlUrl });
  if (repo.hasPages) resources.push({ type:'github_pages', value:`https://${repo.fullName.split('/')[0]}.github.io/${repo.name}/`, label:'GitHub Pages' });
  for (const f of facts) {
    if (f.type === 'firebase_projectId') resources.push({ type:'firebase_project', value:f.value, label:'Firebase Projekt' });
    if (f.type === 'firebase_databaseURL') resources.push({ type:'firebase_database_url', value:f.value, label:'Firebase Realtime Database URL' });
    if (f.type === 'firebase_authDomain') resources.push({ type:'firebase_auth_domain', value:f.value, label:'Firebase Auth Domain' });
    if (f.type === 'firebase_storageBucket') resources.push({ type:'firebase_storage_bucket', value:f.value, label:'Firebase Storage Bucket' });
  }
  for (const f of facts.filter(f => f.type === 'realtime_path' || f.type === 'rules_path' || f.type === 'firestore_collection')) {
    resources.push({ type:f.type, value:f.value, label:f.type === 'realtime_path' ? 'Realtime DB Pfad' : f.type === 'rules_path' ? 'Firebase Rules Pfad' : 'Firestore Collection' });
  }
  return uniqueBy(resources, r => `${r.type}:${r.value}`);
}

function buildGuardrails(projectGroup, analyses, best) {
  const rules = [
    'Bestehende Funktionen erhalten. Änderungen nicht blind aus anderen Projekten übernehmen.',
    'Secrets, Tokens, Passwörter und private Schlüssel nicht in ZIPs oder Chat-Ausgaben übernehmen.',
    'Bei ZIP-Deploy werden vorhandene Dateien überschrieben, aber nicht automatisch gelöscht.'
  ];
  if (projectGroup === 'quizt-laura') rules.push('Quizt ist ein externes Projekt für Laura und darf nicht als ChiefCards-Projekt behandelt werden.');
  if (analyses.js.firebase.refs.length || analyses.json.rules.length) rules.push('Firebase Rules und Datenbankstruktur nur ergänzend ändern und gemeinsame Ressourcen vorher prüfen.');
  if (best?.domain === 'queue') rules.push('Queue-Projekt nur ändern, wenn konkrete Queue-Funktionen betroffen sind. Firebase-Projektname allein reicht nicht als Begründung.');
  return rules;
}

function uniqueBy(arr, fn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = fn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
