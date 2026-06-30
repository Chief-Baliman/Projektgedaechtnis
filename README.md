# Chief Developer Hub v9.0

Developer Hub mit GitHub-Scanner, Scanner Debug, Multi-KI-Codeanalyse, Kostenkontrolle, Analyse-Cache, Delta-Analyse und GitHub-Deployment.

## Neu in v9.0

- Kostenschätzung vor KI-Analyse
- gespeicherte KI-Analyse wird weiterverwendet, solange der Code-Fingerprint gleich bleibt
- Analyse-Fingerprint und Datei-Hashes werden gespeichert
- Delta-Modus für neue oder geänderte Dateien
- Warnung, wenn eine Analyse bereits aktuell ist
- OpenAI/Gemini/Groq/OpenRouter/Mistral weiter auswählbar

## Update auf VPS

```bash
cd /opt/projects/developer-hub
git fetch --all
git reset --hard origin/main
npm install --no-audit --no-fund
systemctl restart developer-hub
systemctl status developer-hub --no-pager
```

Danach im Browser hart neu laden.

## Nutzung

1. Repo normal scannen.
2. Tab KI-Analyse öffnen.
3. Kosten schätzen klicken.
4. Bei Bedarf Vollanalyse oder Delta-Analyse starten.

Normales Öffnen, Wiki lesen, Kontext kopieren und gespeicherte Analyse ansehen erzeugt keine API-Kosten.
