# VPS Setup

## 1. Projekt hochladen

```bash
git clone https://github.com/DEIN-NAME/DEIN-REPO.git developer-hub
cd developer-hub
npm run install:all
```

## 2. Environment anlegen

```bash
cp server/.env.example server/.env
nano server/.env
```

Wichtig:

- `ADMIN_PASSWORD` setzen
- `SESSION_SECRET` lang und zufällig setzen
- `ENCRYPTION_KEY` mit 32 Zeichen setzen

## 3. Build

```bash
npm run build
```

## 4. Start mit PM2

```bash
npm install -g pm2
pm2 start server/src/index.js --name developer-hub
pm2 save
pm2 startup
```

## 5. Nginx Beispiel

```nginx
server {
  server_name deine-domain.de;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## 6. HTTPS

```bash
sudo certbot --nginx -d deine-domain.de
```
