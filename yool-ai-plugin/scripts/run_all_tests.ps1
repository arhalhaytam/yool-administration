# Run integration scripts against an already-running gateway (https://localhost by default).
# Prerequisites: Docker stack is up; from repo root: docker compose up -d
# (or CI: docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d --build)

param(
    [string]$BaseUrl = "https://localhost"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "Using base URL: $BaseUrl"

python test_api.py --base-url $BaseUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

python test_session.py --base-url $BaseUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

python test_auth.py --base-url $BaseUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "All integration scripts passed."
