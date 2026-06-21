#!/usr/bin/env python3
"""
validate.py — Pre-build validator for Yool AI Plugin.

Catches errors BEFORE docker compose build so you don't waste time rebuilding.

Run: python validate.py
"""

import ast
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent

ERRORS: list[str] = []
WARNINGS: list[str] = []
PASSES: list[str] = []


def ok(msg: str) -> None:
    PASSES.append(f"  ✅  {msg}")


def warn(msg: str) -> None:
    WARNINGS.append(f"  ⚠️   {msg}")


def fail(msg: str) -> None:
    ERRORS.append(f"  ❌  {msg}")


# ── 1. Python syntax check ────────────────────────────────────────────────────

PYTHON_SERVICES = [
    "services/auth",
    "services/session",
    "services/query",
    "services/stt",
    "shared",
    "migrations",
]

def check_python_syntax() -> None:
    print("\n[1] Python syntax check...")
    bad = 0
    total = 0
    for base in PYTHON_SERVICES:
        for path in (ROOT / base).rglob("*.py"):
            total += 1
            src = path.read_text(encoding="utf-8")
            try:
                ast.parse(src, filename=str(path))
            except SyntaxError as e:
                rel = path.relative_to(ROOT)
                fail(f"SyntaxError in {rel}:{e.lineno}: {e.msg}")
                bad += 1
    if bad == 0:
        ok(f"All {total} Python files parse cleanly")
    else:
        fail(f"{bad}/{total} Python files have syntax errors")


# ── 2. Forward-ref / string annotation check ─────────────────────────────────

STRING_ANN_RE = re.compile(r'body:\s*"(\w+)"')

def check_string_annotations() -> None:
    print("\n[2] String annotation check (forward refs)...")
    for base in PYTHON_SERVICES:
        for path in (ROOT / base).rglob("*.py"):
            src = path.read_text(encoding="utf-8")
            for m in STRING_ANN_RE.finditer(src):
                rel = path.relative_to(ROOT)
                fail(f"String annotation `{m.group()}` in {rel} — Pydantic v2 cannot resolve at load time")


# ── 3. Default ordering check (FastAPI Depends before defaulted params) ───────

DEPENDS_RE = re.compile(
    r'async def \w+\([^)]*'
    r'(\w+:\s*\w[\w\[\], ]*=\s*\w+[^,)]*),\s*'  # param with default
    r'(\w+:\s*Annotated\[)',                        # followed by Annotated (no default)
    re.DOTALL,
)

def check_default_ordering() -> None:
    print("\n[3] Parameter default ordering check...")
    any_found = False
    for base in PYTHON_SERVICES:
        for path in (ROOT / base).rglob("*.py"):
            src = path.read_text(encoding="utf-8")
            if DEPENDS_RE.search(src):
                rel = path.relative_to(ROOT)
                fail(f"Possible parameter ordering issue in {rel} — default param before Depends() param")
                any_found = True
    if not any_found:
        ok("No parameter ordering issues detected")


# ── 4. .env completeness check ────────────────────────────────────────────────

REQUIRED_ENV = [
    "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB",
    "DATABASE_URL", "REDIS_URL", "REDIS_PASSWORD",
    "JWT_PRIVATE_KEY_PATH", "JWT_PUBLIC_KEY_PATH", "JWT_ALGORITHM",
    "OPENAI_API_KEY", "HF_TOKEN",
    "WHISPER_MODEL", "WHISPER_DEVICE", "WHISPER_COMPUTE_TYPE",
    "ENVIRONMENT",
]

def check_env_file() -> None:
    print("\n[4] .env completeness check...")
    env_path = ROOT / ".env"
    if not env_path.exists():
        fail(".env file not found — copy .env.example to .env and fill in values")
        return

    content = env_path.read_text(encoding="utf-8")
    missing = []
    empty = []
    for key in REQUIRED_ENV:
        pattern = re.compile(rf"^{key}=(.*)$", re.MULTILINE)
        m = pattern.search(content)
        if not m:
            missing.append(key)
        elif m.group(1).strip() in ("", '""', "''"):
            empty.append(key)

    if missing:
        fail(f"Missing .env keys: {', '.join(missing)}")
    if empty:
        fail(f"Empty .env values: {', '.join(empty)}")
    if not missing and not empty:
        ok(f"All {len(REQUIRED_ENV)} required env vars are set")
    
    # Warn if using placeholder values
    if "YOUR_" in content or "CHANGE_ME" in content:
        warn(".env may contain placeholder values — check before deploying")


# ── 5. Secrets check ──────────────────────────────────────────────────────────

def check_secrets() -> None:
    print("\n[5] Secrets directory check...")
    secrets = ROOT / "secrets"
    if not secrets.exists():
        fail("secrets/ directory not found — run: python generate_keys.py")
        return
    
    private = secrets / "jwt_private.pem"
    public = secrets / "jwt_public.pem"

    if not private.exists():
        fail("secrets/jwt_private.pem not found — run: python generate_keys.py")
    else:
        # Check it's actually a PEM file
        content = private.read_text()
        if "BEGIN" not in content:
            fail("secrets/jwt_private.pem appears empty or corrupt")
        else:
            ok("jwt_private.pem exists and looks valid")

    if not public.exists():
        fail("secrets/jwt_public.pem not found — run: python generate_keys.py")
    else:
        content = public.read_text()
        if "BEGIN" not in content:
            fail("secrets/jwt_public.pem appears empty or corrupt")
        else:
            ok("jwt_public.pem exists and looks valid")


# ── 6. Nginx certs check ──────────────────────────────────────────────────────

def check_certs() -> None:
    print("\n[6] TLS certificate check...")
    certs = ROOT / "nginx" / "certs"
    crt = certs / "server.crt"
    key = certs / "server.key"

    if not crt.exists() or not key.exists():
        warn("nginx/certs/server.crt or server.key not found — build.bat will generate them automatically")
    else:
        ok("nginx/certs/server.crt and server.key exist")


# ── 7. Requirements version consistency check ─────────────────────────────────

DEPRECATED_PKGS = {
    "google-generativeai": "Replace with openai>=1.30.0",
    "google-genai": "Replace with openai>=1.30.0",
}

def check_requirements() -> None:
    print("\n[7] Requirements file check...")
    req_files = list(ROOT.rglob("requirements*.txt"))
    issues = 0
    for req in req_files:
        content = req.read_text(encoding="utf-8")
        rel = req.relative_to(ROOT)
        for pkg, msg in DEPRECATED_PKGS.items():
            for line in content.splitlines():
                stripped = line.strip()
                # Skip comment lines
                if stripped.startswith("#"):
                    continue
                if pkg in stripped:
                    fail(f"{rel}: deprecated package `{pkg}` — {msg}")
                    issues += 1
                    break
        # Check numpy constraint in stt
        if "stt" in str(req) and "numpy" in content:
            if "numpy<2" not in content and "numpy>=1" not in content:
                warn(f"{rel}: numpy has no <2.0 upper bound — pyannote.audio will break on numpy 2.x")
    if issues == 0:
        ok(f"Checked {len(req_files)} requirements files — no deprecated packages")


# ── 8. Dockerfile entrypoint check for STT ───────────────────────────────────

def check_stt_dockerfile() -> None:
    print("\n[8] STT Dockerfile check...")
    df = ROOT / "services" / "stt" / "Dockerfile"
    if not df.exists():
        fail("services/stt/Dockerfile not found")
        return

    content = df.read_text()
    if "gosu" not in content:
        fail("STT Dockerfile missing gosu — model cache volume will have permission errors")
    elif "entrypoint.sh" not in content:
        fail("STT Dockerfile missing entrypoint.sh — model cache volume will have permission errors")
    else:
        ok("STT Dockerfile has gosu + entrypoint.sh (volume permission fix)")
    
    ep = ROOT / "services" / "stt" / "entrypoint.sh"
    if not ep.exists():
        fail("services/stt/entrypoint.sh not found")
    else:
        ok("entrypoint.sh exists")


# ── 9. docker-compose healthcheck completeness ────────────────────────────────

def check_compose() -> None:
    print("\n[9] docker-compose.yml check...")
    dc = ROOT / "docker-compose.yml"
    if not dc.exists():
        fail("docker-compose.yml not found")
        return
    content = dc.read_text()

    # Split into service blocks by finding top-level service names under 'services:'
    # A service definition starts with exactly 2-space indent: "  auth:"
    service_block_re = re.compile(r"^  (\w+):$", re.MULTILINE)
    service_names = [m.group(1) for m in service_block_re.finditer(content)]

    # For each service, extract just its block (until the next top-level key)
    blocks: dict[str, str] = {}
    positions = [(m.group(1), m.start()) for m in service_block_re.finditer(content)]
    for i, (name, start) in enumerate(positions):
        end = positions[i + 1][1] if i + 1 < len(positions) else len(content)
        blocks[name] = content[start:end]

    skip = {"volumes", "networks", "postgres_data", "redis_data", "model_cache", "internal", "migrate"}
    missing_hc = [
        name for name, block in blocks.items()
        if name not in skip and "healthcheck" not in block
    ]
    if missing_hc:
        warn(f"Services without healthcheck: {', '.join(missing_hc)}")
    else:
        ok("All services have healthchecks")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("  Yool AI Plugin — Pre-build Validator")
    print("=" * 60)

    check_python_syntax()
    check_string_annotations()
    check_default_ordering()
    check_env_file()
    check_secrets()
    check_certs()
    check_requirements()
    check_stt_dockerfile()
    check_compose()

    print("\n" + "=" * 60)
    print("  Results")
    print("=" * 60)

    for p in PASSES:
        print(p)
    for w in WARNINGS:
        print(w)
    for e in ERRORS:
        print(e)

    print()
    if ERRORS:
        print(f"  🔴  {len(ERRORS)} error(s) found — fix before building")
        sys.exit(1)
    elif WARNINGS:
        print(f"  🟡  {len(WARNINGS)} warning(s) — review before deploying to production")
        print("  ✅  Safe to build (warnings are non-blocking)")
        sys.exit(0)
    else:
        print("  ✅  All checks passed — safe to build!")
        sys.exit(0)


if __name__ == "__main__":
    main()
