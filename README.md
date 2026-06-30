# Chief Developer Hub / Projektgedächtnis

Eine zentrale Web-App für deine ChatGPT-Entwicklungsprojekte.

## Was diese Version kann

- Login per Admin-Passwort
- GitHub-Token zentral und verschlüsselt speichern
- GitHub-Repositories laden
- Repositories scannen
- Firebase, GitHub Pages, wichtige Dateien, TODOs und Risiken erkennen
- Projektgedächtnis pro Repository speichern
- Abhängigkeiten über gemeinsame Firebase-Projekte erkennen
- ChatGPT-Kontext erzeugen
- ZIP-Dateien in ein ausgewähltes Repository hochladen
- Dateien aus ZIP überschreiben, aber nicht vorhandene Dateien bleiben erhalten
- Letzten Commit vor Upload als Rollback-Punkt speichern
- Letzten Upload per Button zurücksetzen
- Secrets, VPS und Bots als Projektwissen speichern
- Export und Import des Projektgedächtnisses

## Wichtig

Diese App ist für deinen eigenen VPS gedacht. Nicht als öffentliche GitHub-Pages-Seite betreiben.

## Schnellstart lokal

1. Node.js installieren
2. `.env.example` nach `server/.env` kopieren
3. Werte eintragen
4. Im Hauptordner ausführen:

```bash
npm run install:all
npm run dev
```

Frontend:
http://localhost:5173

Backend:
http://localhost:8787

## Deployment auf VPS

Siehe `docs/VPS_SETUP.md`.

## GitHub Token

Für die erste Version wird ein Fine-grained Personal Access Token genutzt.
Benötigte Rechte:

- Metadata: Read
- Contents: Read and write

OAuth-Struktur ist vorbereitet, aber für den schnellen produktiven Einsatz ist Token-Speicherung aktuell der stabilste Weg.
