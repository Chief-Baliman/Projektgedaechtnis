function lines(list, prefix = '- ') {
  return (list || []).length ? list.map((item) => `${prefix}${item}`).join('\n') : `${prefix}keine erkannt`;
}

export function generateContext(project, allProjects, options = {}) {
  const a = project.analysis;
  const related = options.includeDependencies
    ? allProjects.filter((item) => a.dependencies.sharedFirebase.includes(item.fullName))
    : [];
  const task = options.task?.trim() || 'Bitte entwickle dieses Projekt auf Basis des folgenden aktuellen Standes weiter.';

  const parts = [];
  parts.push(`Ich möchte an folgendem Projekt weiterarbeiten. Bitte berücksichtige den aktuellen Stand und erhalte bestehende Funktionen.\n`);
  parts.push(`Aufgabe:\n${task}\n`);
  parts.push(`Projekt:\n- Name: ${a.fullName}\n- Beschreibung: ${a.description || 'keine Beschreibung im Repository'}\n- Standard-Branch: ${a.defaultBranch}\n- Privat: ${a.private ? 'ja' : 'nein'}\n- Repository: ${a.htmlUrl}\n- GitHub Pages: ${a.pagesUrl || 'nicht sicher erkannt'}\n- Letzter Scan: ${new Date(a.scannedAt).toLocaleString('de-DE')}\n- Dateien im Repository: ${a.fileCount}\n`);
  parts.push(`Technik:\n${lines(a.tech)}\n`);
  parts.push(`Erkannte Dienste:\n- Firebase: ${a.firebase.hits.length ? a.firebase.hits.join('; ') : 'nicht erkannt'}\n- Firebase Projekt-IDs: ${a.firebase.projectIds.length ? a.firebase.projectIds.join(', ') : 'keine erkannt'}\n- Realtime-Database URLs: ${a.firebase.dbUrls.length ? a.firebase.dbUrls.join(', ') : 'keine erkannt'}\n- Hosting: ${a.hosting.length ? a.hosting.join('; ') : 'nicht sicher erkannt'}\n- Bots/Server: ${a.bots.length ? a.bots.join('; ') : 'nicht sicher erkannt'}\n`);

  if (options.includeDependencies) {
    parts.push(`Abhängigkeiten und gemeinsame Ressourcen:\n${related.length ? related.map((item) => `- ${item.fullName}: teilt wahrscheinlich Firebase-Ressourcen mit diesem Projekt`).join('\n') : '- keine gemeinsamen Ressourcen erkannt'}\n`);
  }

  if (options.includeFileList) {
    parts.push(`Wichtige Dateien:\n${lines(a.importantFiles)}\n`);
  }

  if (a.todos.length) {
    parts.push(`TODOs im Code:\n${lines(a.todos)}\n`);
  }

  if (a.secretWarnings.length) {
    parts.push(`Sicherheitswarnung:\nIn folgenden Dateien wurden mögliche Secrets oder Tokens erkannt. Diese niemals in Antworten oder ZIPs offenlegen:\n${lines(a.secretWarnings)}\n`);
  }

  if (options.includeGuardrails) {
    parts.push(`Arbeitsregeln für ChatGPT:\n${lines(a.guardrails)}\n- Wenn du eine ZIP-Datei erstellst, liefere vollständige Projektdateien für den Upload.\n- Dateien, die nicht geändert werden müssen, trotzdem nur dann verändern, wenn es fachlich nötig ist.\n- Bei Firebase, GitHub Pages, VPS oder Bot-Themen zuerst prüfen, ob andere Projekte betroffen sind.\n`);
  }

  parts.push(`Gewünschtes Ergebnis:\nBitte liefere eine klare Lösung und, falls Code geändert werden soll, eine vollständige ZIP-Struktur passend für dieses Repository.`);
  return parts.join('\n');
}
