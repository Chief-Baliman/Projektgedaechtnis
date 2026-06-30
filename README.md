# Projektgedächtnis

Eine kleine Developer-Zentrale für ChatGPT-Projekte.

## Was Version 1.0 kann

- GitHub Token lokal speichern
- Repositories über die GitHub API laden
- Repository auswählen
- Repository-Dateibaum scannen
- wichtige Projektdateien lesen
- Firebase, GitHub Pages, Bots, Server-Hinweise und Technik erkennen
- Projektgedächtnis lokal im Browser speichern
- ChatGPT-Kontext für neue Chats erzeugen
- Abhängigkeiten über gemeinsame Firebase-Projekte erkennen
- lokale Daten exportieren und importieren

## Was noch nicht aktiv ist

Die Bereiche ZIP-Deploy, Firebase-Verwaltung und VPS/Bots sind als Module in der Oberfläche vorbereitet, aber noch nicht vollständig umgesetzt.

## GitHub Token

Für Version 1 reicht ein Fine-grained GitHub Token mit Leserechten auf die gewünschten Repositories.

Empfohlene Rechte:

- Metadata: Read-only
- Contents: Read-only

Später für ZIP-Deploy nötig:

- Contents: Read and write

## Nutzung

1. ZIP entpacken.
2. Alle Dateien in ein neues GitHub Repository hochladen.
3. GitHub Pages aktivieren.
4. Seite öffnen.
5. GitHub Token eintragen.
6. Repositories laden.
7. Projekt scannen.
8. ChatGPT-Kontext erzeugen und kopieren.

## Sicherheit

Der Token wird nur lokal im Browser gespeichert. Diese Version nutzt keinen eigenen Server.

Secrets wie Passwörter, API Keys oder private SSH Keys werden nicht in den erzeugten ChatGPT-Kontext übernommen. Das Tool warnt, wenn mögliche Secrets im Code erkannt werden.

## Wichtig

Wenn du dieses Tool online über GitHub Pages nutzt, ist die Anwendung öffentlich erreichbar. Deine lokalen Daten und dein Token liegen aber im Browser des jeweiligen Geräts. Nutze trotzdem keinen fremden Computer dafür.
