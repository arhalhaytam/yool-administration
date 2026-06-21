#!/bin/sh
set -e

# ── Fix model cache permissions ───────────────────────────────────────────────
# Docker named volumes are created root-owned regardless of Dockerfile chown.
# This entrypoint runs as root, fixes ownership, then drops to appuser.
# Runs every startup (cheap — just chown, not recursive if already correct).

mkdir -p /app/.cache/huggingface /app/.cache/torch

# Only chown if needed (avoids slow recursive chown on large model caches)
CACHE_OWNER=$(stat -c '%u' /app/.cache 2>/dev/null || echo "0")
if [ "$CACHE_OWNER" != "1000" ]; then
    echo "[entrypoint] Fixing /app/.cache ownership → appuser (uid 1000)"
    chown -R appuser:appuser /app/.cache
fi

# Drop privileges and exec the actual application
exec gosu appuser uvicorn main:app \
    --host 0.0.0.0 \
    --port 8003 \
    --workers 1
