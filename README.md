# Chief Developer Hub v6

Zentrale Entwickleroberfläche für GitHub-Projekte, Projektgedächtnis, Code-Analyse, ChatGPT-Kontext und ZIP-Deployments.

## Kernfunktionen

- Login mit Admin-Passwort
- GitHub Token serverseitig verschlüsselt speichern
- Repositories laden
- Repository vollständig über GitHub Tree API inventarisieren
- Code wirklich lesen und auswerten
- Scanner Debug mit Datei, Zeile, Snippet und Begründung
- Projekt-Wiki und ChatGPT-Kontext aus Code-Fakten generieren
- Ressourcen erkennen, ohne daraus blind den Projektzweck abzuleiten
- Firebase-Projekt-ID wird als Ressource behandelt, nicht als Zweck
- ZIP-Deploy ins Repository
- letzter Upload als Rollback-Punkt
- Projektgruppen: ChiefCards, ChiefBaliman, Quizt/Laura, Infrastruktur, Privat, Unsortiert

## Start auf dem VPS

```bash
cd /opt/projects/developer-hub
git pull
npm install
npm start
```

Die `.env` bleibt auf dem Server und wird nicht hochgeladen.
