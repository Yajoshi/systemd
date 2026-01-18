# Edge Onboarding (Systemd-only, No Docker)

This project template runs an **edge onboarding portal** on Ubuntu as **native systemd services**:

- **Keycloak** (SSO/OIDC)
- **edge-agent** (root) – reads/applies OS config: Proxy, LAN/Netplan, LXD, MicroK8s
- **edge-api** (unprivileged) – backend-for-frontend, verifies Keycloak JWT and proxies to agent
- **edge-portal** (React/Vite) – UI served by Nginx
- **Nginx** – serves the portal and reverse-proxies `/api` and `/auth`

## Quick start (Ubuntu VM)

### 0) Prereqs
```bash
sudo apt update
sudo apt install -y git curl unzip jq nginx nodejs npm openjdk-17-jre
```

### 1) Copy this project
```bash
sudo mkdir -p /opt/edge-onboard
sudo cp -r edge-onboard-systemd/* /opt/edge-onboard/
sudo chown -R $USER:$USER /opt/edge-onboard
```

### 2) Install and enable services
```bash
cd /opt/edge-onboard
sudo ./scripts/install.sh
```

### 3) Open
- Portal: `http://localhost/`
- Keycloak admin: `http://localhost/auth` (proxied) or `http://localhost:8081`

Default Keycloak admin (change after first login):
- Username: `admin`
- Password: `admin123`

## Systemd services
- `keycloak.service` (port `8081`, realm import from `/opt/keycloak/data/import/edge-realm.json`)
- `edge-agent.service` (root, listens `127.0.0.1:4100`)
- `edge-api.service` (unprivileged, listens `127.0.0.1:8080`)

## Security model
- UI logs in via Keycloak (OIDC) and obtains an access token.
- API validates the token (JWKS) and forwards requests to the agent.
- Agent validates the token again and enforces **role** `edge-admin` for apply endpoints.

## Endpoints
- `GET /api/inventory` – read current Proxy/LAN/VM/LXD/MicroK8s
- `POST /api/apply/proxy` – apply proxy settings
- `POST /api/apply/netplan` – apply netplan yaml
- `POST /api/apply/lxd/network` – update LXD network config
- `POST /api/apply/microk8s/addons` – enable/disable addons

## Notes
- LXD **VMs** may not run inside a VM (nested virtualization). LXD **containers** will still work.
- Netplan apply can break networking if misconfigured. This template validates with `netplan generate` first.
