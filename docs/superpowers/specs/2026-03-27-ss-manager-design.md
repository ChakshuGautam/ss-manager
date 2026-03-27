# ss-manager: Screenshot Manager

**Date**: 2026-03-27
**Status**: Approved

## Overview

A utility that automatically uploads macOS screenshots to a remote MinIO server and provides a React Admin UI to browse and copy public URLs. Single-user, personal tool.

## Architecture

```
Local Mac (launchd)              egov server (Docker Compose)
┌─────────────┐     S3 PUT      ┌──────────────────────────────┐
│ chokidar     │────────────────▶│ MinIO (port 9000)            │
│ ~/Desktop/   │   (HTTPS via    │  └─ bucket: screenshots      │
│ Screenshot*  │    ss.chakshu.  │     (public-read policy)     │
└─────────────┘    com/s3/)      ├──────────────────────────────┤
                                 │ Express API (port 3001)      │
                                 │  ├─ /api/screenshots (CRUD)  │
                                 │  └─ serves React Admin SPA   │
                                 └──────────────────────────────┘
                                         ▲
                                    nginx reverse proxy
                                    ss.chakshu.com (HTTPS)
```

## Components

### 1. Local Watcher (`watcher/`)

**Purpose**: Watch ~/Desktop for new screenshots, upload to MinIO immediately.

**Tech**: Node.js + chokidar + minio JS SDK

**Behavior**:
- Watches `~/Desktop/` for files matching `Screenshot*.png` (new files only, `add` event)
- On new file: waits 500ms for file write to complete, then uploads to MinIO bucket `screenshots`
- S3 key: original filename (e.g., `Screenshot 2026-03-27 at 2.15.03 PM.png`)
- Content-Type set to `image/png`
- Tracks uploaded files in `~/.ss-manager/uploaded.json` to avoid re-uploading on restart
- Logs to stdout (captured by launchd)

**Configuration** (`~/.ss-manager/.env`):
```
MINIO_ENDPOINT=ss.chakshu.com
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=<generated>
MINIO_SECRET_KEY=<generated>
MINIO_BUCKET=screenshots
WATCH_DIR=~/Desktop
```

**launchd** (`~/Library/LaunchAgents/com.chakshu.ss-manager.plist`):
- RunAtLoad: true
- KeepAlive: true
- StandardOutPath/StandardErrorPath: `~/Library/Logs/ss-manager.log`
- WorkingDirectory: repo's watcher/ directory

**Install script** (`watcher/install.sh`):
- Runs `npm install`
- Creates `~/.ss-manager/` directory
- Prompts for MinIO credentials if `.env` doesn't exist
- Copies and loads launchd plist

### 2. Express API (`server/api/`)

**Purpose**: Thin REST API between MinIO and React Admin.

**Tech**: Express.js + minio JS SDK

**Endpoints**:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/screenshots` | List screenshots with pagination, sort. Returns `{data: [...], total: N}` for React Admin |
| GET | `/api/screenshots/:key` | Get single screenshot metadata (name, size, lastModified, url) |
| DELETE | `/api/screenshots/:key` | Delete a screenshot from MinIO |

**Response shape** (for list):
```json
{
  "data": [
    {
      "id": "Screenshot 2026-03-27 at 2.15.03 PM.png",
      "name": "Screenshot 2026-03-27 at 2.15.03 PM.png",
      "size": 225874,
      "lastModified": "2026-03-27T08:45:03.000Z",
      "url": "https://ss.chakshu.com/s3/screenshots/Screenshot%202026-03-27%20at%202.15.03%20PM.png"
    }
  ],
  "total": 42
}
```

**Static file serving**: Serves the built React Admin SPA from `./public/` directory at `/`.

**Environment variables**:
```
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=<same as watcher>
MINIO_SECRET_KEY=<same as watcher>
MINIO_BUCKET=screenshots
PUBLIC_URL_BASE=https://ss.chakshu.com/s3/screenshots
```

**No auth**: Single user, personal tool. The domain is the only access control needed.

### 3. React Admin SPA (`server/web/`)

**Purpose**: Browse screenshots, copy public URLs.

**Tech**: React Admin + Vite

**Features**:
- **List view**: Grid/table of screenshots with thumbnails, sorted by date (newest first)
- **Copy URL button**: Click to copy the public URL to clipboard
- **Delete action**: Remove screenshot from MinIO
- **Thumbnail preview**: Shows small preview in list, click to open full size
- **Search/filter**: Filter by filename

**Data provider**: Custom provider that maps React Admin's `getList`, `getOne`, `delete` to the Express API endpoints.

**Build**: `npm run build` outputs to `dist/`, which gets copied to the API's `public/` directory.

### 4. Docker Compose (`server/docker-compose.yml`)

**Services**:

**minio**:
- Image: `minio/minio`
- Command: `server /data --console-address ":9001"`
- Ports: `9000:9000` (API), `9001:9001` (console, internal only)
- Volumes: `minio-data:/data`
- Environment: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`

**api**:
- Build from `server/api/Dockerfile`
- Port: `3001:3001`
- Depends on: minio
- Volumes: web build output mounted at `/app/public`
- Environment: MinIO connection details

**Startup**: An init script in the API container creates the `screenshots` bucket and sets public-read policy if they don't exist.

### 5. Nginx Config (`nginx/ss.chakshu.com.conf`)

```nginx
server {
    listen 443 ssl;
    server_name ss.chakshu.com;

    # SSL certs (managed by certbot)
    ssl_certificate /etc/letsencrypt/live/ss.chakshu.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ss.chakshu.com/privkey.pem;

    # React Admin + API
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Direct public access to screenshots
    location /s3/ {
        proxy_pass http://127.0.0.1:9000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name ss.chakshu.com;
    return 301 https://$host$request_uri;
}
```

### 6. Deploy Script (`deploy.sh`)

- Builds React Admin SPA locally
- SCPs the `server/` directory to egov
- SSHs to egov and runs `docker compose up -d --build`
- Copies nginx config and reloads nginx
- Runs certbot for SSL if needed

## Repo Structure

```
ss-manager/
├── watcher/
│   ├── index.js              # File watcher + uploader
│   ├── package.json
│   ├── install.sh            # Setup launchd + .env
│   └── com.chakshu.ss-manager.plist
├── server/
│   ├── api/
│   │   ├── index.js          # Express API
│   │   ├── package.json
│   │   └── Dockerfile
│   ├── web/
│   │   ├── src/
│   │   │   ├── App.jsx
│   │   │   ├── dataProvider.js
│   │   │   └── ScreenshotList.jsx
│   │   ├── package.json
│   │   └── vite.config.js
│   └── docker-compose.yml
├── deploy.sh
├── nginx/
│   └── ss.chakshu.com.conf
└── README.md
```

## Data Flow

1. User takes screenshot on Mac → file appears in `~/Desktop/`
2. Watcher detects new `Screenshot*.png` via chokidar
3. Watcher uploads file to MinIO via S3 PUT (through `ss.chakshu.com/s3/`)
4. Screenshot now publicly accessible at `https://ss.chakshu.com/s3/screenshots/<filename>`
5. User opens `https://ss.chakshu.com` → React Admin UI
6. UI calls `GET /api/screenshots` → API lists objects from MinIO bucket
7. User clicks "Copy URL" → public URL copied to clipboard

## Security

- Single-user tool — no auth on the UI or API
- MinIO credentials stored in local `.env` files only, never committed
- Screenshots bucket has public-read policy (intentional — sharing is the purpose)
- Write access requires MinIO credentials (only the watcher has them)
- HTTPS everywhere via Let's Encrypt
