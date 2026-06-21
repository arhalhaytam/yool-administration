#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
#  generate_certs.sh — Generate a self-signed TLS certificate for local dev
#
#  For PRODUCTION: replace server.crt / server.key with a real certificate
#  from Let's Encrypt (certbot) or your CA.
#
#  Usage: sh scripts/generate_certs.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

CERT_DIR="$(dirname "$0")/../nginx/certs"
mkdir -p "$CERT_DIR"

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$CERT_DIR/server.key" \
    -out    "$CERT_DIR/server.crt" \
    -subj "/C=DZ/ST=Algiers/L=Algiers/O=Yool AI/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo ""
echo "Self-signed certificate generated at:"
echo "  $CERT_DIR/server.crt"
echo "  $CERT_DIR/server.key"
echo ""
echo "For production, replace these files with your real certificate."
echo "Let's Encrypt (free): https://certbot.eff.org/"
