# This directory holds TLS certificates for Nginx.
# 
# For LOCAL DEV: run scripts/generate_certs.sh to generate a self-signed cert.
#   sh scripts/generate_certs.sh
#
# For PRODUCTION: replace server.crt and server.key with your real certificate.
#   - Let's Encrypt (free): https://certbot.eff.org/
#   - Or copy from your CA/certificate provider.
#
# These files are gitignored (*.crt, *.key in .gitignore).
