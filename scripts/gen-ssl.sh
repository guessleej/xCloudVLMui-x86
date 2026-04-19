#!/usr/bin/env bash
###############################################################################
# gen-ssl.sh — 產生自簽 TLS 憑證（WebRTC 需要 HTTPS）
###############################################################################
set -euo pipefail

SSL_DIR="$(cd "$(dirname "$0")/.." && pwd)/ssl"
mkdir -p "${SSL_DIR}"

CERT="${SSL_DIR}/server.crt"
KEY="${SSL_DIR}/server.key"

if [[ -f "${CERT}" && -f "${KEY}" ]]; then
  echo "✓ TLS 憑證已存在，跳過。"
  exit 0
fi

echo "產生自簽 TLS 憑證（有效期 3650 天）..."

# 嘗試取得 AIR-030 IP
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout "${KEY}" \
  -out    "${CERT}" \
  -days   3650 \
  -subj   "/C=TW/ST=Taiwan/L=Taipei/O=xCloud/CN=AIR-030" \
  -addext "subjectAltName=IP:${IP},IP:127.0.0.1,DNS:localhost,DNS:air-030"

chmod 600 "${KEY}"
echo "✓ 憑證產生完成："
echo "  CRT: ${CERT}"
echo "  KEY: ${KEY}"
echo "  SAN IP: ${IP}"
