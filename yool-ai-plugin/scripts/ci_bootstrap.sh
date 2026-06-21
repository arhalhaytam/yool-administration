#!/usr/bin/env bash
# Creates secrets, TLS certs, and .env for Docker Compose (local CI or GitHub Actions).
# Safe to run multiple times; overwrites .env each time with deterministic CI defaults.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p secrets nginx/certs

if [[ ! -f secrets/jwt_private.pem ]]; then
  openssl genrsa -out secrets/jwt_private.pem 2048
  openssl rsa -in secrets/jwt_private.pem -pubout -out secrets/jwt_public.pem
elif [[ ! -f secrets/jwt_public.pem ]]; then
  openssl rsa -in secrets/jwt_private.pem -pubout -out secrets/jwt_public.pem
fi

if [[ ! -f nginx/certs/server.crt ]] || [[ ! -f nginx/certs/server.key ]]; then
  sh scripts/generate_certs.sh
fi

POSTGRES_USER="${POSTGRES_USER:-yool_ci}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-yool_ci_db_secret}"
POSTGRES_DB="${POSTGRES_DB:-yool_ci}"
REDIS_PASSWORD="${REDIS_PASSWORD:-yool_ci_redis_secret}"

cat > .env <<EOF
# --- Compose / Postgres / Redis (used by docker-compose variable substitution) ---
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
REDIS_PASSWORD=${REDIS_PASSWORD}

# --- Apps (service containers) ---
ENVIRONMENT=development
LOG_LEVEL=INFO

DATABASE_URL=postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

JWT_PRIVATE_KEY_PATH=/app/secrets/jwt_private.pem
JWT_PUBLIC_KEY_PATH=/app/secrets/jwt_public.pem

SUPER_ADMIN_BOOTSTRAP_EMAIL=superadmin@yool.ai
SUPER_ADMIN_BOOTSTRAP_PASSWORD=ChangeMe2026!

FRONTEND_URL=http://localhost:3000

# Required by STT / Query containers (dummy values OK when using docker-compose.ci.yml STT stub)
GEMINI_API_KEY=ci-dummy-gemini
HF_TOKEN=ci-dummy-hf
EOF

echo "ci_bootstrap: wrote .env and ensured secrets + nginx/certs under ${ROOT}"
