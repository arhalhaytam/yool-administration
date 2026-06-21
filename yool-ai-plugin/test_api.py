"""
test_api.py — High-level smoke test across the full Yool AI Plugin stack.

Bootstraps:
  1. Logs in as the seeded super_admin
  2. Creates a teacher via teacher-invite
  3. Creates a course (admin) assigned to that teacher
  4. Starts and stops a session
  5. Pings the query and STT services

Run: python test_api.py
     python test_api.py --base-url https://myserver.com
"""

import argparse
import http.cookiejar
import json
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
import ssl
import uuid

# ── Config ────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="https://localhost")
args = parser.parse_args()
BASE = args.base_url.rstrip("/")

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

COOKIE_JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(
    urllib.request.HTTPSHandler(context=CTX),
    urllib.request.HTTPCookieProcessor(COOKIE_JAR),
)


def _require_gateway() -> None:
    rq = urllib.request.Request(BASE + "/health", method="GET")
    try:
        with OPENER.open(rq, timeout=15) as r:
            if r.status != 200:
                raise urllib.error.URLError(f"unexpected HTTP {r.status}")
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        print(f"\n[ERROR] Cannot reach {BASE}/health ({reason}).")
        print("  Start (full stack):  docker compose up -d")
        print(
            "  Start (CI stub STT): docker compose -f docker-compose.yml "
            "-f docker-compose.ci.yml up -d --build"
        )
        print("  Then run:             bash scripts/run_all_tests.sh")
        print("  Windows:              .\\scripts\\run_all_tests.ps1")
        sys.exit(2)


_require_gateway()

PASS = 0
FAIL = 0


def req(method, path, body=None, token=None, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    rq = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with OPENER.open(rq, timeout=15) as r:
            status = r.status
            try:
                resp = json.loads(r.read())
            except Exception:
                resp = {}
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            resp = json.loads(e.read())
        except Exception:
            resp = {}
    return status, resp


def check(name, status, resp, expected_status, key=None, expected_val=None):
    global PASS, FAIL
    ok = status == expected_status
    if ok and key:
        ok = key in resp
    if ok and expected_val is not None:
        ok = resp.get(key) == expected_val

    symbol = "[OK]" if ok else "[XX]"
    print(f"  {symbol}  {name}")
    if not ok:
        print(f"        Expected {expected_status}, got {status}")
        if resp:
            print(f"        Response: {json.dumps(resp)[:300]}")
        FAIL += 1
    else:
        PASS += 1
    return ok, resp


def check_any(name, status, accepted, note=""):
    global PASS, FAIL
    ok = status in accepted
    symbol = "[OK]" if ok else "[XX]"
    suffix = f"  ({note})" if note else ""
    print(f"  {symbol}  {name} -> {status}{suffix}")
    if not ok:
        print(f"        Expected one of {accepted}, got {status}")
        FAIL += 1
    else:
        PASS += 1
    return ok


# =============================================================================
print("=" * 60)
print("  Yool AI Plugin - End-to-End API Test")
print(f"  Target: {BASE}")
print("=" * 60)

uid = uuid.uuid4().hex[:8]

# ── 1. Nginx gateway ──────────────────────────────────────────────────────────
print("\n[1] Nginx gateway")
s, r = req("GET", "/health")
check("GET /health", s, r, 200)


# ── 2. Super-admin login ─────────────────────────────────────────────────────
print("\n[2] Super-admin login")

s, r = req("POST", "/api/auth/login", {
    "email": "superadmin@yool.ai",
    "password": "ChangeMe2026!",
})
ok, login_r = check("POST /api/auth/login (super_admin)", s, r, 200, key="access_token")
sa_token = login_r.get("access_token", "") if ok else ""


# ── 3. Create a teacher (via invite) ──────────────────────────────────────────
print("\n[3] Create teacher via invite")

teacher_email = f"teacher_{uid}@example.com"
teacher_pw    = "TeachPass1!"
teacher_token = ""
teacher_id    = ""

if sa_token:
    s, r = req("POST", "/api/auth/admin/teacher-invites",
               {"email": teacher_email, "role": "teacher"}, token=sa_token)
    ok, inv = check("POST /admin/teacher-invites (teacher)", s, r, 201, key="invite_url")
    if ok:
        token = inv["invite_url"].split("?token=")[-1]
        s, r = req("POST", "/api/auth/teacher-invites/accept", {
            "token": token, "full_name": "Teacher Alice", "password": teacher_pw,
        })
        ok2, acc = check("POST /teacher-invites/accept", s, r, 201,
                         key="role", expected_val="teacher")
        if ok2:
            teacher_id = acc.get("id", "")
            time.sleep(1)
            s, r = req("POST", "/api/auth/login",
                       {"email": teacher_email, "password": teacher_pw})
            ok3, lr = check("POST /api/auth/login (teacher)", s, r, 200, key="access_token")
            if ok3:
                teacher_token = lr.get("access_token", "")


# ── 4. Create a course (admin assigns to teacher) ────────────────────────────
print("\n[4] Create course (admin -> teacher)")

course_id = ""
if sa_token and teacher_id:
    s, r = req("POST", "/api/courses/", {
        "title":      f"Test Course {uid}",
        "subject":    "Computer Science",
        "teacher_id": teacher_id,
    }, token=sa_token)
    ok, cr = check("POST /api/courses/ (admin assigns)", s, r, 201, key="id")
    if ok:
        course_id = cr.get("id", "")

# Teacher cannot create their own course (regression guard)
if teacher_token and teacher_id:
    s, r = req("POST", "/api/courses/", {
        "title": "Hijack", "subject": "Hack", "teacher_id": teacher_id,
    }, token=teacher_token)
    check("POST /api/courses/ (teacher -> 403)", s, r, 403)


# ── 5. Session lifecycle ──────────────────────────────────────────────────────
print("\n[5] Session lifecycle")

session_id = ""
if teacher_token and course_id:
    s, r = req("POST", f"/api/sessions/courses/{course_id}/start",
               {}, token=teacher_token)
    ok, sr = check("POST /api/sessions/courses/{id}/start", s, r, 201,
                   key="status", expected_val="live")
    if ok:
        session_id = sr.get("id", "")

if teacher_token and session_id:
    s, r = req("POST", f"/api/sessions/{session_id}/end", token=teacher_token)
    check("POST /api/sessions/{id}/end", s, r, 200,
          key="status", expected_val="processing")


# ── 6. Query service ──────────────────────────────────────────────────────────
print("\n[6] Query service")

# Topic outline not ready yet — expect 404 or 409
if teacher_token and session_id:
    s, r = req("GET", f"/api/query/sessions/{session_id}/summary",
               token=teacher_token)
    check_any("GET /api/query/sessions/{id}/summary",
              s, [200, 404, 409, 422],
              note="no AI run yet — 404/409 expected")


# ── 7. STT service health ─────────────────────────────────────────────────────
print("\n[7] STT service")
s, r = req("GET", "/api/stt/health")
check_any("GET /api/stt/health", s, [200, 404],
          note="route may not be exposed via nginx in dev")


# ── 8. Auth logout ────────────────────────────────────────────────────────────
print("\n[8] Auth logout")

if teacher_token:
    s, r = req("POST", "/api/auth/logout", token=teacher_token)
    check("POST /api/auth/logout -> 204", s, r, 204)


# ── Results ───────────────────────────────────────────────────────────────────
total = PASS + FAIL
print("\n" + "=" * 60)
print(f"  Results: {PASS}/{total} passed")
if FAIL == 0:
    print("  All tests passed - stack is fully functional!")
else:
    print(f"  {FAIL} test(s) failed - check output above")
print("=" * 60)
sys.exit(0 if FAIL == 0 else 1)
