export function generateWiki(analysis) {
  const lines = [];
  lines.push(`# ${analysis.repo.fullName}`);
  lines.push('');
  lines.push(`Scanner-Version: ${analysis.scannerVersion}`);
  lines.push(`Gescannt: ${analysis.scannedAt}`);
  lines.push('');
  lines.push('## Zweck');
  lines.push('');
  lines.push(`${analysis.purpose.text}`);
  lines.push('');
  lines.push(`Sicherheit: ${Math.round((analysis.purpose.confidence || 0) * 100)} %`);
  lines.push('');
  if (analysis.purpose.evidence?.length) {
    lines.push('### Belege');
    for (const ev of analysis.purpose.evidence.slice(0, 8)) {
      lines.push(`- ${ev.file}${ev.line ? `:${ev.line}` : ''} | ${ev.value} | ${ev.reason}`);
    }
    lines.push('');
  }
  if (analysis.conflicts?.length) {
    lines.push('## Konflikte / Unsicherheiten');
    lines.push('');
    analysis.conflicts.forEach(c => lines.push(`- ${c}`));
    lines.push('');
  }
  lines.push('## Architektur');
  lines.push('');
  if (analysis.architecture.length) analysis.architecture.forEach(a => lines.push(`- ${a}`));
  else lines.push('- Keine eindeutige Architektur erkannt.');
  lines.push('');
  lines.push('## Inventar');
  lines.push('');
  lines.push(`- Dateien insgesamt: ${analysis.inventory.totalFiles}`);
  lines.push(`- Dateien gelesen: ${analysis.inventory.readFiles}`);
  lines.push(`- Bytes gelesen: ${analysis.inventory.totalBytesRead}`);
  lines.push('');
  lines.push('### Sprachen');
  Object.entries(analysis.inventory.languageCounts || {}).forEach(([lang,count]) => lines.push(`- ${lang}: ${count}`));
  lines.push('');
  lines.push('## Ressourcen');
  lines.push('');
  if (analysis.resources.length) analysis.resources.forEach(r => lines.push(`- ${r.label}: ${r.value}`));
  else lines.push('- Keine Ressourcen erkannt.');
  lines.push('');
  lines.push('## Wichtige Regeln');
  lines.push('');
  analysis.guardrails.forEach(g => lines.push(`- ${g}`));
  lines.push('');
  lines.push('## Wichtigste Code-Fakten');
  lines.push('');
  analysis.facts.slice(0, 40).forEach(f => lines.push(`- ${f.category}/${f.type}: ${f.value} (${f.file}${f.line ? `:${f.line}` : ''})`));
  return lines.join('\n');
}

export function generateContext(analysis) {
  const lines = [];
  lines.push('Ich möchte an folgendem Projekt weiterarbeiten. Bitte nutze diesen Kontext und verändere bestehende Funktionen nur gezielt.');
  lines.push('');
  lines.push(`Projekt: ${analysis.repo.fullName}`);
  lines.push(`Projektgruppe: ${analysis.projectGroup}`);
  lines.push(`Zweck: ${analysis.purpose.text}`);
  lines.push(`Sicherheit der Einordnung: ${Math.round((analysis.purpose.confidence || 0) * 100)} %`);
  lines.push(`GitHub: ${analysis.repo.htmlUrl}`);
  if (analysis.repo.hasPages) lines.push(`GitHub Pages: https://${analysis.repo.fullName.split('/')[0]}.github.io/${analysis.repo.name}/`);
  lines.push('');
  lines.push('Architektur:');
  analysis.architecture.forEach(a => lines.push(`- ${a}`));
  lines.push('');
  lines.push('Ressourcen und Datenpfade:');
  analysis.resources.slice(0, 30).forEach(r => lines.push(`- ${r.label}: ${r.value}`));
  lines.push('');
  lines.push('Wichtige Regeln:');
  analysis.guardrails.forEach(g => lines.push(`- ${g}`));
  if (analysis.conflicts?.length) {
    lines.push('');
    lines.push('Unsicherheiten/Konflikte:');
    analysis.conflicts.forEach(c => lines.push(`- ${c}`));
  }
  lines.push('');
  lines.push('Code-Belege:');
  analysis.facts.slice(0, 30).forEach(f => lines.push(`- ${f.file}${f.line ? `:${f.line}` : ''} | ${f.category}/${f.type} | ${f.value}`));
  lines.push('');
  lines.push('Bitte liefere bei Codeänderungen eine vollständige ZIP mit allen benötigten Dateien auf Repository-Root-Ebene. Keine Secrets in Code oder Ausgabe aufnehmen.');
  return lines.join('\n');
}
