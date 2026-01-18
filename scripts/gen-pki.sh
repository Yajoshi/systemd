#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKI="$ROOT/pki"
mkdir -p "$PKI"

CA_KEY="$PKI/ca.key"
CA_CRT="$PKI/ca.crt"

API_KEY="$PKI/api.edge.local.key"
API_CSR="$PKI/api.edge.local.csr"
API_CRT="$PKI/api.edge.local.crt"
API_EXT="$PKI/api.ext"

if [[ ! -f "$CA_KEY" ]]; then
  echo "[+] Generating CA..."
  openssl genrsa -out "$CA_KEY" 4096
  openssl req -x509 -new -nodes -key "$CA_KEY" -sha256 -days 3650     -subj "/CN=edge-local-CA"     -out "$CA_CRT"
else
  echo "[=] CA already exists."
fi

echo "[+] Generating API server certificate for api.edge.local..."
openssl genrsa -out "$API_KEY" 2048

cat > "$API_EXT" <<'EOF'
subjectAltName = @alt_names
extendedKeyUsage = serverAuth
keyUsage = digitalSignature, keyEncipherment
basicConstraints = CA:FALSE

[alt_names]
DNS.1 = api.edge.local
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF

openssl req -new -key "$API_KEY" -out "$API_CSR" -subj "/CN=api.edge.local"
openssl x509 -req -in "$API_CSR" -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial   -out "$API_CRT" -days 825 -sha256 -extfile "$API_EXT"

echo "[+] Done."
echo "CA:  $CA_CRT"
echo "API: $API_CRT"
