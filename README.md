# Chief Developer Hub v2.2

Lauffähiger Developer Hub mit Server-Login, verschlüsseltem GitHub-Token, Repository-Scanner, Projektgedächtnis, ChatGPT-Kontext und ZIP-Deploy.

## Neu in v2.2

- echtere Codeanalyse statt generischer Projekttexte
- Code-Signatur pro Repository
- Erkennung von App-Domänen wie Angebots-Tracking, Queue-Verwaltung, Scoreboard, Market-Tools
- Angebots-Tracker wird nicht mehr als Queue-Tracker beschrieben, wenn Angebot/Offer/Deal-Signale vorhanden sind
- Anzeige von erkannten Funktionen, UI-Texten, State-Keys und Datei-Zusammenfassungen
- ChatGPT-Kontext enthält Scanner-Signale und Scan-Qualität
- Guardrails warnen vor falscher Projektlogik, z. B. Angebot nicht als Queue behandeln

## Update auf dem VPS

Nach Upload der entpackten Dateien ins GitHub-Repository:

```bash
cd /opt/projects/developer-hub
git pull
npm install
```

Falls der Server noch im Terminal läuft, mit STRG+C stoppen und danach neu starten:

```bash
npm start
```

Danach im Hub die betroffenen Projekte neu scannen. Für geteilte Ressourcen am besten einmal „Alle scannen“ ausführen.
