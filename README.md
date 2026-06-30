# Chief Developer Hub v3.0

Stand: Scanner neu aufgebaut.

## Wichtigste Änderung
Der Scanner arbeitet jetzt nicht mehr nur mit groben Regex-Signalen, sondern erzeugt zuerst ein Roh-Inventar:

- gelesene Dateien
- Content-Hash je Datei
- Zeilenanzahl
- Treffer mit Datei, Zeile und Snippet
- feste Firebase-Pfade getrennt von dynamischen Firebase-Pfaden
- Domain-Scores auf Basis echter Code-Funde
- Konflikte zwischen Repo-Name und Code-Signalen

Wenn ein Repo wie `angebots-tracker` in Wirklichkeit Queue-Code enthält, wird das als Konflikt markiert und mit Code-Belegen angezeigt.

## Update auf VPS

```bash
cd /opt/projects/developer-hub
git pull
npm install
# laufenden npm-start-Prozess mit STRG+C beenden
npm start
```

Danach im Hub das betroffene Repository neu scannen.
