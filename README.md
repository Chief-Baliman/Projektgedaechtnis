# Chief Developer Hub v8

Developer Hub mit GitHub-Scanner, Scanner Debug, Code-Fakten, ZIP-Deploy, Rollback und Multi-Provider-KI-Codeanalyse.

## Neu in v8

- KI-Anbieter auswählbar: Google Gemini, Groq, OpenRouter, Mistral, OpenAI
- API Keys werden serverseitig verschlüsselt gespeichert
- Anbieter und Modell werden im Hub gespeichert
- KI-Analyse nutzt weiter den gelesenen Code-Korpus und die Scanner-Fakten
- OpenAI bleibt möglich, ist aber nicht mehr Pflicht

## Update

1. Inhalt dieser ZIP ins GitHub-Repository hochladen.
2. Auf dem VPS:

```bash
cd /opt/projects/developer-hub
git fetch --all
git reset --hard origin/main
npm install
pkill -f "node server/src/index.js" || true
npm start
```

3. Browser hart neu laden.
4. KI-Anbieter links wählen, Modell prüfen, Key speichern.
5. Repo scannen.
6. Tab KI-Analyse öffnen und Analyse starten.
