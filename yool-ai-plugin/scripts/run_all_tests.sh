#!/usr/bin/env bash
# Run integration scripts against an already-running gateway (https://localhost by default).
# Exit non-zero if any script fails.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE_URL="${1:-https://localhost}"

echo "Using base URL: ${BASE_URL}"

python3 test_api.py --base-url "${BASE_URL}"
python3 test_session.py --base-url "${BASE_URL}"
python3 test_auth.py --base-url "${BASE_URL}"

echo ""
echo "All integration scripts passed."
