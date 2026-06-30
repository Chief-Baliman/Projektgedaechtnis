# Chief Developer Hub v2.1

Lauffähiger Developer Hub mit Login, serverseitig verschlüsseltem GitHub-Token, Repo-Scanner, Projektgedächtnis, ChatGPT-Kontext, ZIP-Deploy und Rollback.

Neu in v2.1:

- Projektwelten: ChiefCards / Fabian, Quizt / Laura, Server / Bots, Unsortiert
- Quizt wird als externes Projekt für Laura erkannt und nicht mit ChiefCards vermischt
- Besserer Projektkontext mit Besitz-/Trennungsregeln
- Erweiterter Scanner für Firebase-Pfade, Datenmodelle, Routen und geteilte Ressourcen
- Verbesserter ChatGPT-Kontextgenerator
- Manuelle Projektgruppe im Tab Notizen änderbar

Start:

```bash
npm install
npm start
```

.env benötigt:

```env
PORT=8787
APP_ORIGIN=http://217.154.249.255:8787
ADMIN_PASSWORD=...
ENCRYPTION_KEY=...
```
