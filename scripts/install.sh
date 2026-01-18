#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/opt/edge-onboard"
KEYCLOAK_VERSION="25.0.6"

echo "[1/9] Create users"
if ! id -u keycloak >/dev/null 2>&1; then
  sudo useradd -r -s /usr/sbin/nologin keycloak
fi
if ! id -u edgeapi >/dev/null 2>&1; then
  sudo useradd -r -s /usr/sbin/nologin edgeapi
fi

echo "[2/9] Install Node deps"
cd "$ROOT_DIR/agent" && npm install
cd "$ROOT_DIR/api" && npm install

echo "[3/9] Build portal"
cd "$ROOT_DIR/portal" && npm install && npm run build

echo "[4/9] Install Keycloak zip"
if [ ! -d /opt/keycloak ]; then
  cd /opt
  sudo curl -L -o keycloak.zip "https://github.com/keycloak/keycloak/releases/download/${KEYCLOAK_VERSION}/keycloak-${KEYCLOAK_VERSION}.zip"
  sudo unzip -q keycloak.zip
  sudo mv "keycloak-${KEYCLOAK_VERSION}" /opt/keycloak
  sudo rm -f keycloak.zip
fi
sudo chown -R keycloak:keycloak /opt/keycloak

echo "[5/9] Copy realm import"
sudo mkdir -p /opt/keycloak/data/import
sudo cp "$ROOT_DIR/keycloak/edge-realm.json" /opt/keycloak/data/import/edge-realm.json
sudo chown -R keycloak:keycloak /opt/keycloak/data/import

echo "[6/9] Write env files"
sudo mkdir -p /etc/keycloak /etc/edge-onboard
sudo tee /etc/keycloak/keycloak.env >/dev/null <<ENV
KC_HTTP_PORT=8081
KC_HOSTNAME_STRICT=false
KC_PROXY=edge
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=admin123
ENV

sudo tee /etc/edge-onboard/agent.env >/dev/null <<ENV
NODE_ENV=production
AGENT_PORT=4100
AGENT_BIND=127.0.0.1
KEYCLOAK_ISSUER=http://localhost:8081/realms/edge
ADMIN_ROLE=edge-admin
ENV

sudo tee /etc/edge-onboard/api.env >/dev/null <<ENV
NODE_ENV=production
API_PORT=8080
API_BIND=127.0.0.1
KEYCLOAK_ISSUER=http://localhost:8081/realms/edge
AGENT_URL=http://127.0.0.1:4100
ADMIN_ROLE=edge-admin
ENV

echo "[7/9] Install systemd units"
sudo cp "$ROOT_DIR/infra/systemd/keycloak.service" /etc/systemd/system/keycloak.service
sudo cp "$ROOT_DIR/infra/systemd/edge-agent.service" /etc/systemd/system/edge-agent.service
sudo cp "$ROOT_DIR/infra/systemd/edge-api.service" /etc/systemd/system/edge-api.service

sudo systemctl daemon-reload

echo "[8/9] Configure Nginx"
sudo cp "$ROOT_DIR/infra/nginx/edge-portal.conf" /etc/nginx/sites-available/edge-portal
sudo ln -sf /etc/nginx/sites-available/edge-portal /etc/nginx/sites-enabled/edge-portal
sudo rm -f /etc/nginx/sites-enabled/default || true
sudo nginx -t
sudo systemctl restart nginx

echo "[9/9] Enable and start services"
sudo systemctl enable --now keycloak
sudo systemctl enable --now edge-agent
sudo systemctl enable --now edge-api

echo "\nDONE. Open: http://localhost/"
echo "Keycloak: http://localhost/auth (admin/admin123)"
echo "Logs: journalctl -u keycloak -f | journalctl -u edge-agent -f | journalctl -u edge-api -f"
