#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE="/etc/systemd/system/edge-agent.service"

sudo mkdir -p /var/lib/edge-agent
sudo chmod 700 /var/lib/edge-agent

cat <<EOF | sudo tee "$SERVICE" >/dev/null
[Unit]
Description=Edge Device Agent (mTLS bootstrap)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$ROOT
Environment=API_BASE=https://api.edge.local:8443
Environment=STATE_DIR=/var/lib/edge-agent
ExecStart=/usr/bin/node $ROOT/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now edge-agent
echo "[+] Started. Logs: journalctl -u edge-agent -f"
