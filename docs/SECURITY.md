# Sicherheit

- GitHub-Token werden mit AES-256-GCM verschlüsselt gespeichert.
- Secrets werden nicht im ChatGPT-Kontext ausgegeben.
- Secrets werden nur als Platzhalter erwähnt, z. B. "GitHub Token ist hinterlegt".
- ZIP-Deploy löscht keine bestehenden Dateien, wenn sie nicht in der ZIP liegen.
- Vor jedem Upload wird der aktuelle Branch-Commit als Rollback-Punkt gespeichert.
- Rollback setzt den Branch auf diesen Commit zurück.

Wichtig: Diese App sollte durch HTTPS und ein starkes Admin-Passwort geschützt werden.
