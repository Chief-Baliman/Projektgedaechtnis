# Developer Hub Pro v11

Neu in v11:

- Server-/VPS-Doku dauerhaft speichern: IP, Anbieter, SSH, Domain, OS, Projektpfade, systemd-Services und Hinweise.
- Server-Inventar zeigt Host, OS, IPs, /opt-Projekte, systemd-Services und Ports.
- Firebase-Doku erweitert: Projekt-ID, Database URL, Auth Domain, Storage Bucket, Firebase Account/User, Console URL und Notizen.
- Firebase Rules können als JSON eingefügt werden. Der Hub organisiert daraus Pfade und .read/.write-Regeln.
- Firebase-Kontext und Server-Kontext werden serverseitig generierbar und später in ChatGPT-Kontexte einbindbar.
- Projektzweck wird weiterhin nicht aus Firebase-Projektnamen abgeleitet.

Update:

```bash
cd /opt/projects/developer-hub
git fetch --all
git reset --hard origin/main
npm install --no-audit --no-fund
systemctl restart developer-hub
systemctl status developer-hub --no-pager
```
