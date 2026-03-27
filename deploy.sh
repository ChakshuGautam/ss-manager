#!/bin/bash
set -e

echo "=== Building React Admin SPA ==="
cd server/web
npm install
npm run build
cd ../..

echo "=== Deploying to egov ==="
# Create remote directory
ssh egov "mkdir -p /opt/ss-manager/api /opt/ss-manager/web"

# Copy server files
scp -r server/api/package.json server/api/index.js server/api/Dockerfile egov:/opt/ss-manager/api/
scp -r server/docker-compose.yml egov:/opt/ss-manager/
scp -r server/web/dist egov:/opt/ss-manager/web/

# Copy .env if it exists, otherwise copy example
if [ -f server/.env ]; then
    scp server/.env egov:/opt/ss-manager/.env
else
    scp server/.env.example egov:/opt/ss-manager/.env
    echo "Warning: Edit /opt/ss-manager/.env on egov server"
fi

echo "=== Starting services ==="
ssh egov "cd /opt/ss-manager && docker compose up -d --build"

echo "=== Setting up nginx ==="
scp nginx/ss.chakshu.com.conf egov:/etc/nginx/sites-available/ss.chakshu.com
ssh egov "ln -sf /etc/nginx/sites-available/ss.chakshu.com /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx"

echo "=== Setting up SSL ==="
ssh egov "certbot --nginx -d ss.chakshu.com --non-interactive --agree-tos --email admin@chakshu.com || echo 'SSL setup may need manual intervention'"

echo "Deployed! Visit https://ss.chakshu.com"
