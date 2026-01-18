# Edge SSO Bootstrap (Keycloak on edge + Portal + Node API + mTLS Agent)

A runnable lab to test:
- Keycloak on the edge (SSO)
- Portal UI (React/Vite)
- Node API (HTTPS) that validates Keycloak JWTs for admin routes
- Device Agent (systemd) that bootstraps device trust + mTLS (CSR -> signed cert)

## Quick Start (Ubuntu VM)
1) Install Docker:
```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates openssl jq unzip
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

2) On your Mac, add /etc/hosts:
Find VM IP inside VM:
```bash
ip -4 addr show | grep -E "inet .*global" | awk '{print $2}' | cut -d/ -f1
```
Then on Mac:
```
<VM_IP> edge.local portal.edge.local keycloak.edge.local api.edge.local
```

3) Generate PKI (inside VM):
```bash
cd edge-sso-bootstrap
./scripts/gen-pki.sh
```

4) Start stack:
```bash
cd edge-sso-bootstrap/infra
docker compose up -d --build
```

Open:
- Portal: http://portal.edge.local:3000
- Keycloak: http://keycloak.edge.local:8080

Portal login: edgeadmin / edgeadmin  
Keycloak admin: kcadmin / kcadmin

5) Start agent:
```bash
cd ~/edge-sso-bootstrap/agent
npm ci
sudo ./install.sh
journalctl -u edge-agent -f
```

Agent logs show pairingCode. In Portal -> Devices -> Claim, enter pairingCode.

Then queue tasks: SET_PROXY / CHECK_MICROK8S / LIST_LXD_VMS
