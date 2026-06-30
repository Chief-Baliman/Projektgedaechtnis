# Chief Developer Hub v5.0

Diese Version enthält den neuen Scanner v5:

- vollständiges Datei-Inventar mit Hash, Zeilen, Bytes und Sprache
- JavaScript/TypeScript-AST-Analyse mit Acorn
- HTML-Analyse
- JSON-Analyse
- Firebase-Rules-Analyse
- Regex-Fakten nur noch als zusätzliche Rohsignale
- Firebase-Projekt-ID wird als Ressource behandelt, nicht als Projektzweck
- Scanner-Debug-Tab mit Datei-Inventar, Fakten und Klassifizierung
- Quizt bleibt als externe Projektwelt getrennt von ChiefCards

Nach dem Hochladen auf GitHub auf dem VPS:

```bash
cd /opt/projects/developer-hub
git pull
npm install
# laufenden npm start Prozess mit STRG+C stoppen
npm start
```

Danach betroffene Repositories neu scannen.
