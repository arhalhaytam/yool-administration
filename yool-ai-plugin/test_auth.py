"""
test_auth.py — Auth service test suite (post enterprise pivot).

The platform is enterprise-only — students no longer exist. This test suite
verifies:

  1.  Health checks
  2.  Super-admin login (bootstrapped at startup)
  3.  Teacher onboarding invite flow (create → preview → accept)
  3h. Admin role privilege checks (admin can/can't do)
  4.  Teacher login + profile
  5.  Refresh token rotation
  6.  JWT blocklist (logout invalidates access token)
  7.  Active sessions list + selective revocation
  8.  Forgot-password flow (no email enumeration)
  9.  Admin privilege checks (super-admin supremacy)
  10. Audit log query
  11. Login rate limiting
  12. Token security (refresh reuse, missing cookie, malformed Bearer)
  13. Password self-service (change password)
  14. Password reset token lifecycle
  15. Privilege escalation guards (teacher cannot reach admin routes, etc.)
  16. Admin user-management tools
  17. GDPR account erasure

Run:
    python test_auth.py
    python test_auth.py --base-url https://myserver.com
"""

import argparse
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import ssl

# ── CLI ───────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="https://localhost")
args = parser.parse_args()
BASE = args.base_url.rstrip("/")

# SSL — skip verification for self-signed dev certs
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

COOKIE_JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(
    urllib.request.HTTPSHandler(context=CTX),
    urllib.request.HTTPCookieProcessor(COOKIE_JAR),
)


def _require_gateway() -> None:
    """Fail fast with a clear message when no stack is listening."""
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

PASS = FAIL = SKIP = 0
SECTION_FAILS = []


# ── HTTP helper ───────────────────────────────────────────────────────────────

def req(method, path, body=None, token=None, params=None, _retries=3):
    """Send a request. Retries on 503 (nginx rate-limit) with exponential backoff."""
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    last_status, last_resp = None, {}
    for attempt in range(_retries + 1):
        rq = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with OPENER.open(rq, timeout=15) as r:
                raw = r.read()
                try:
                    resp = json.loads(raw) if raw else {}
                except Exception:
                    resp = {}
                last_status, last_resp = r.status, resp
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                resp = json.loads(raw) if raw else {}
            except Exception:
                resp = {}
            last_status, last_resp = e.code, resp
        if last_status == 503 and attempt < _retries:
            time.sleep(1.0 * (attempt + 1))
            continue
        return last_status, last_resp
    return last_status, last_resp


# ── Assertion helpers ─────────────────────────────────────────────────────────

def ok(name, status, resp, expected_status, key=None, expected_val=None):
    global PASS, FAIL
    passed = (status == expected_status)
    if passed and key:
        passed = key in resp
    if passed and expected_val is not None:
        passed = resp.get(key) == expected_val

    if passed:
        print(f"  [OK]  {name}")
        PASS += 1
    else:
        print(f"  [XX]  {name}")
        print(f"        Expected {expected_status}, got {status}")
        if resp:
            print(f"        Body: {json.dumps(resp)[:300]}")
        FAIL += 1
        SECTION_FAILS.append(name)
    return passed, resp


def ok_any(name, status, accepted, resp=None, note=""):
    global PASS, FAIL
    passed = status in accepted
    suffix = f"  ({note})" if note else ""
    if passed:
        print(f"  [OK]  {name} -> {status}{suffix}")
        PASS += 1
    else:
        print(f"  [XX]  {name} -> {status}{suffix}")
        print(f"        Expected one of {accepted}")
        if resp:
            print(f"        Body: {json.dumps(resp)[:300]}")
        FAIL += 1
        SECTION_FAILS.append(name)
    return passed


def skip(name, reason):
    global SKIP
    print(f"  [--] {name}  (skipped: {reason})")
    SKIP += 1


def section(title):
    print(f"\n{'-'*60}")
    print(f"  {title}")
    print(f"{'-'*60}")


def req_raw(method, path, cookie_str=None, token=None):
    """Like req() but bypasses the shared cookie jar — sends a raw Cookie header."""
    url = BASE + path
    hdrs = {"Content-Type": "application/json"}
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    if cookie_str:
        hdrs["Cookie"] = cookie_str
    rq = urllib.request.Request(url, headers=hdrs, method=method)
    bare = urllib.request.build_opener(urllib.request.HTTPSHandler(context=CTX))
    try:
        with bare.open(rq, timeout=15) as r:
            raw = r.read()
            try:
                resp = json.loads(raw) if raw else {}
            except Exception:
                resp = {}
            return r.status, resp
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            resp = json.loads(raw) if raw else {}
        except Exception:
            resp = {}
        return e.code, resp


# ── Test state (carried across sections) ─────────────────────────────────────
state = {
    "super_admin_token":   None,
    "admin_token":         None,
    "teacher_token":       None,
    "admin_email":         None,
    "admin_id":            None,
    "teacher_email":       None,
    "teacher_id":          None,
    "teacher_invite_token": None,
    "old_refresh_cookie":  None,   # §12 refresh-token reuse test
}

UID = uuid.uuid4().hex[:8]   # unique suffix for this test run

# =============================================================================
print("=" * 60)
print("  Yool AI Plugin - Auth Service Test Suite")
print(f"  Target : {BASE}")
print(f"  Run ID : {UID}")
print("=" * 60)


# ── §1  Health ────────────────────────────────────────────────────────────────
section("§1  Health checks")

s, r = req("GET", "/health")
ok("GET /health (nginx gateway)", s, r, 200)

s, r = req("GET", "/api/auth/health")
ok("GET /api/auth/health", s, r, 200)


# ── §2  Super-admin login ─────────────────────────────────────────────────────
section("§2  Super-admin login (bootstrapped on startup)")

s, r = req("POST", "/api/auth/login", {
    "email": "superadmin@yool.ai",
    "password": "ChangeMe2026!",
})
passed, login_r = ok("POST /api/auth/login (super_admin)", s, r, 200, key="access_token")
if passed:
    state["super_admin_token"] = login_r["access_token"]

if state["super_admin_token"]:
    s, r = req("GET", "/api/auth/me", token=state["super_admin_token"])
    ok("GET /api/auth/me -> role=super_admin", s, r, 200, key="role", expected_val="super_admin")


# ── §3  Teacher invite flow ───────────────────────────────────────────────────
section("§3  Teacher invite: create -> preview -> accept")

teacher_email = f"teacher_{UID}@example.com"
teacher_password = "TeachPass1!"
state["teacher_email"] = teacher_email

# 3a. Super admin creates teacher invite
if state["super_admin_token"]:
    s, r = req("POST", "/api/auth/admin/teacher-invites",
               {"email": teacher_email, "role": "teacher"},
               token=state["super_admin_token"])
    passed, inv_r = ok("POST /admin/teacher-invites (create)", s, r, 201, key="invite_url")
    if passed:
        token_part = inv_r["invite_url"].split("?token=")[-1]
        state["teacher_invite_token"] = token_part
else:
    skip("POST /admin/teacher-invites", "no super_admin token")

# 3b. Create an admin invite (only super_admin can issue admin-level invites)
admin_email    = f"admin_{UID}@example.com"
admin_password = "AdminPass1!"
state["admin_email"] = admin_email
admin_invite_token = None

if state["super_admin_token"]:
    s, r = req("POST", "/api/auth/admin/teacher-invites",
               {"email": admin_email, "role": "admin"},
               token=state["super_admin_token"])
    passed, inv_r = ok("POST /admin/teacher-invites role=admin (super_admin OK)", s, r, 201)
    if passed:
        admin_invite_token = inv_r["invite_url"].split("?token=")[-1]

# 3c. Preview invite (public — no auth)
if state["teacher_invite_token"]:
    s, r = req("GET", "/api/auth/teacher-invites/preview",
               params={"token": state["teacher_invite_token"]})
    ok("GET /teacher-invites/preview", s, r, 200, key="email", expected_val=teacher_email)
else:
    skip("GET /teacher-invites/preview", "no invite token")

# 3d. Accept teacher invite
if state["teacher_invite_token"]:
    s, r = req("POST", "/api/auth/teacher-invites/accept", {
        "token":     state["teacher_invite_token"],
        "full_name": "Prof. Dupont",
        "password":  teacher_password,
    })
    passed, acc_r = ok("POST /teacher-invites/accept -> 201", s, r, 201, key="role",
                       expected_val="teacher")
    if passed:
        state["teacher_id"] = acc_r.get("id")

    # 3e. Cannot accept the same invite twice -> 409
    s, r = req("POST", "/api/auth/teacher-invites/accept", {
        "token":     state["teacher_invite_token"],
        "full_name": "Attacker",
        "password":  teacher_password,
    })
    ok("POST /teacher-invites/accept (reuse -> 409)", s, r, 409)
else:
    skip("POST /teacher-invites/accept", "no invite token")

# 3f. Weak password rejected -> 422
if state["super_admin_token"]:
    weak_email = f"weakpw_{UID}@example.com"
    s2, r2 = req("POST", "/api/auth/admin/teacher-invites",
                 {"email": weak_email, "role": "teacher"},
                 token=state["super_admin_token"])
    if s2 == 201:
        weak_token = r2["invite_url"].split("?token=")[-1]
        s, r = req("POST", "/api/auth/teacher-invites/accept", {
            "token":     weak_token,
            "full_name": "Weak User",
            "password":  "password",   # no uppercase, no digit
        })
        ok("POST /teacher-invites/accept (weak pw -> 422)", s, r, 422)
    else:
        skip("Weak password test", "could not create second invite")

# 3g. Accept admin invite -> admin role
if admin_invite_token:
    s, r = req("POST", "/api/auth/teacher-invites/accept", {
        "token":     admin_invite_token,
        "full_name": "Admin User",
        "password":  admin_password,
    })
    passed, acc_r = ok("POST /teacher-invites/accept (admin role) -> 201", s, r, 201,
                       key="role", expected_val="admin")
    if passed:
        state["admin_id"] = acc_r.get("id")
else:
    skip("Admin invite accept", "no admin invite token")


# ── §3h  Admin role privilege checks ──────────────────────────────────────────
section("§3h  Admin role: permissions and limits")

if state.get("admin_id"):
    s, r = req("POST", "/api/auth/login", {"email": admin_email, "password": admin_password})
    passed, lr = ok("POST /api/auth/login (admin)", s, r, 200, key="access_token")
    if passed:
        state["admin_token"] = lr["access_token"]

if state.get("admin_token"):
    # Admin CAN list users
    s, r = req("GET", "/api/auth/admin/users", token=state["admin_token"], params={"limit": 100})
    ok("GET /admin/users (admin) -> 200", s, r, 200)

    # Admin CAN see audit logs
    s, r = req("GET", "/api/auth/admin/audit-logs", token=state["admin_token"], params={"limit": 10})
    ok("GET /admin/audit-logs (admin) -> 200", s, r, 200)

    # Admin CANNOT create an admin-level invite -> 403
    s, r = req("POST", "/api/auth/admin/teacher-invites",
               {"email": f"escalation_{UID}@example.com", "role": "admin"},
               token=state["admin_token"])
    ok("POST /admin/teacher-invites role=admin (admin -> 403)", s, r, 403)

    # Admin CAN create a teacher-level invite
    s, r = req("POST", "/api/auth/admin/teacher-invites",
               {"email": f"teacher2_{UID}@example.com", "role": "teacher"},
               token=state["admin_token"])
    ok("POST /admin/teacher-invites role=teacher (admin -> 201)", s, r, 201)
else:
    skip("§3h admin privilege checks", "admin login failed or no admin created")


# ── §4  Teacher login ─────────────────────────────────────────────────────────
section("§4  Teacher login + profile")

s, r = req("POST", "/api/auth/login", {"email": teacher_email, "password": teacher_password})
passed, lr = ok("POST /api/auth/login (teacher)", s, r, 200, key="access_token")
if passed:
    state["teacher_token"] = lr["access_token"]

if state["teacher_token"]:
    s, r = req("PATCH", "/api/auth/me", {"full_name": "Prof. Dupont Updated"},
               token=state["teacher_token"])
    ok("PATCH /api/auth/me (update name)", s, r, 200, key="full_name",
       expected_val="Prof. Dupont Updated")

    s, r = req("GET", "/api/auth/me", token=state["teacher_token"])
    ok("GET /api/auth/me -> is_verified=true", s, r, 200, key="is_verified", expected_val=True)


# ── §5  Refresh token rotation ────────────────────────────────────────────────
section("§5  Refresh token rotation")

# Capture cookie before rotation so §12 can verify the old token is rejected.
for _c in COOKIE_JAR:
    if _c.name == "refresh_token":
        state["old_refresh_cookie"] = _c.value
        break

s, r = req("POST", "/api/auth/refresh")
passed, rr = ok("POST /api/auth/refresh (cookie) -> 200", s, r, 200, key="access_token")
if passed:
    state["teacher_token"] = rr["access_token"]


# ── §6  JWT blocklist ─────────────────────────────────────────────────────────
section("§6  JWT blocklist: logout then use old token")

if state["teacher_token"]:
    old_token = state["teacher_token"]
    s, r = req("POST", "/api/auth/logout", token=old_token)
    ok("POST /api/auth/logout -> 204", s, r, 204)

    time.sleep(0.5)

    s, r = req("GET", "/api/auth/me", token=old_token)
    ok("GET /api/auth/me (blocklisted token -> 401)", s, r, 401)

    # Re-login (wait a few seconds for nginx auth_login zone)
    time.sleep(3)
    s, r = req("POST", "/api/auth/login", {
        "email":    teacher_email,
        "password": teacher_password,
    })
    if s == 200:
        state["teacher_token"] = r["access_token"]
    else:
        state["teacher_token"] = None
        print(f"  [warn] Re-login after logout returned {s} - §7+ will be skipped")
else:
    skip("§6 JWT blocklist", "no teacher token")


# ── §7  Active sessions ───────────────────────────────────────────────────────
section("§7  Active sessions (device list)")

if state["teacher_token"]:
    s, r = req("GET", "/api/auth/sessions", token=state["teacher_token"])
    passed, sess_list = ok("GET /api/auth/sessions -> list", s, r, 200)
    if passed and isinstance(sess_list, list) and len(sess_list) > 0:
        sess_id = sess_list[0]["id"]
        s, r = req("DELETE", f"/api/auth/sessions/{sess_id}", token=state["teacher_token"])
        ok("DELETE /api/auth/sessions/{id} -> 204", s, r, 204)

        s, r = req("DELETE", f"/api/auth/sessions/{sess_id}", token=state["teacher_token"])
        ok("DELETE /api/auth/sessions/{id} (already revoked -> 409)", s, r, 409)
else:
    skip("§7 active sessions", "no teacher token")


# ── §8  Forgot-password flow ──────────────────────────────────────────────────
section("§8  Forgot-password (no email enumeration)")

# Both registered + non-existent must return the same status (no enumeration).
s, r = req("POST", "/api/auth/forgot-password", {"email": teacher_email})
ok_any("POST /forgot-password (registered) -> 204 or 429", s, [204, 429], r)

s, r = req("POST", "/api/auth/forgot-password", {"email": "ghost@example.com"})
ok_any("POST /forgot-password (non-existent, same response)", s, [204, 429], r,
       note="429 from rate limit is still non-enumerating: both emails get same status")


# ── §9  Admin privilege checks ────────────────────────────────────────────────
section("§9  Admin privilege checks (super-admin supremacy)")

if state["super_admin_token"]:
    s, r = req("GET", "/api/auth/admin/users",
               token=state["super_admin_token"], params={"limit": 100})
    ok("GET /admin/users (super_admin) -> 200", s, r, 200)

    if state["teacher_id"]:
        s, r = req("PATCH", f"/api/auth/admin/users/{state['teacher_id']}",
                   {"is_active": False},
                   token=state["super_admin_token"])
        ok("PATCH /admin/users/{id} deactivate teacher", s, r, 200, key="is_active",
           expected_val=False)

        time.sleep(2)
        s, r = req("POST", "/api/auth/login", {
            "email":    teacher_email,
            "password": teacher_password,
        })
        ok_any("POST /api/auth/login (deactivated -> 401 or 429)", s, [401, 429], r,
               note="account disabled - 429 means nginx rate-limited before app layer")

        s, r = req("PATCH", f"/api/auth/admin/users/{state['teacher_id']}",
                   {"is_active": True},
                   token=state["super_admin_token"])
        ok("PATCH /admin/users/{id} re-activate teacher", s, r, 200, key="is_active",
           expected_val=True)

    # Cannot deactivate the last super_admin
    sa_result = req("GET", "/api/auth/admin/users",
                    token=state["super_admin_token"],
                    params={"role": "super_admin", "limit": 100})
    body = sa_result[1]
    if isinstance(body, dict) and "items" in body:
        super_admins = body["items"]
    elif isinstance(body, list):
        super_admins = body
    else:
        super_admins = []
    if len(super_admins) == 1:
        sa_id = super_admins[0]["id"]
        s, r = req("PATCH", f"/api/auth/admin/users/{sa_id}",
                   {"is_active": False}, token=state["super_admin_token"])
        ok("PATCH /admin/users (deactivate last super_admin -> 409)", s, r, 409)

    if state["teacher_id"]:
        s, r = req("POST", f"/api/auth/admin/users/{state['teacher_id']}/reset-password",
                   {"new_password": "AdminReset1!"},
                   token=state["super_admin_token"])
        ok("POST /admin/users/{id}/reset-password -> 204", s, r, 204)
        # Restore original password so subsequent sections still work
        s, r = req("POST", f"/api/auth/admin/users/{state['teacher_id']}/reset-password",
                   {"new_password": teacher_password},
                   token=state["super_admin_token"])
else:
    skip("§9 admin privilege checks", "no super_admin token")


# ── §10  Audit log ────────────────────────────────────────────────────────────
section("§10  Audit log query")

if state["super_admin_token"]:
    s, r = req("GET", "/api/auth/admin/audit-logs",
               token=state["super_admin_token"], params={"limit": 20})
    ok("GET /admin/audit-logs -> 200", s, r, 200)

    s, r = req("GET", "/api/auth/admin/audit-logs",
               token=state["super_admin_token"],
               params={"action": "user.login", "limit": 100})
    ok("GET /admin/audit-logs?action=user.login -> 200", s, r, 200)
else:
    skip("§10 audit log", "no super_admin token")


# ── §11  Rate limiting ────────────────────────────────────────────────────────
section("§11  Rate limiting (login)")

bad_email = f"ratelimit_{UID}@example.com"
hit_429 = False
for i in range(6):
    s, r = req("POST", "/api/auth/login", {"email": bad_email, "password": "wrong"})
    if s == 429:
        hit_429 = True
        break
ok_any("Login rate limit -> 429 after 5 attempts", 429 if hit_429 else s,
       [429], note="triggers within 6 bad attempts from same IP")


# ── §12  Token security ───────────────────────────────────────────────────────
section("§12  Token security (refresh reuse, missing cookie, malformed JWT)")

s, r = req_raw("POST", "/api/auth/refresh")
ok("POST /api/auth/refresh (no cookie -> 401)", s, r, 401)

if state["old_refresh_cookie"]:
    s, r = req_raw("POST", "/api/auth/refresh",
                   cookie_str=f"refresh_token={state['old_refresh_cookie']}")
    ok("POST /api/auth/refresh (rotated cookie -> 401)", s, r, 401)
else:
    skip("§12b rotated refresh token rejection", "old cookie not captured before §5 rotation")

s, r = req("GET", "/api/auth/me", token="not.a.real.jwt")
ok("GET /api/auth/me (malformed Bearer -> 401)", s, r, 401)


# ── §13  Password self-service ────────────────────────────────────────────────
section("§13  Password self-service (change password)")

admin_new_pw = f"NewAdmin99_{UID}!"

if state["admin_token"] and state.get("admin_email"):
    # 13a. Wrong current password -> 400
    s, r = req("PUT", "/api/auth/users/me/password", {
        "current_password": "TotallyWrong999!",
        "new_password":     admin_new_pw,
    }, token=state["admin_token"])
    ok("PUT /users/me/password (wrong current -> 400)", s, r, 400)

    # 13b. Weak new password -> 422
    s, r = req("PUT", "/api/auth/users/me/password", {
        "current_password": admin_password,
        "new_password":     "alllower123",
    }, token=state["admin_token"])
    ok("PUT /users/me/password (weak new pw -> 422)", s, r, 422)

    # 13c. Successful change -> 204; old token blocklisted
    old_admin_token = state["admin_token"]
    s, r = req("PUT", "/api/auth/users/me/password", {
        "current_password": admin_password,
        "new_password":     admin_new_pw,
    }, token=old_admin_token)
    ok("PUT /users/me/password (valid -> 204)", s, r, 204)

    time.sleep(0.5)

    s, r = req("GET", "/api/auth/me", token=old_admin_token)
    ok("GET /api/auth/me (old token blocked after pw change -> 401)", s, r, 401)

    time.sleep(2)
    s, r = req("POST", "/api/auth/login", {
        "email": state["admin_email"], "password": admin_new_pw,
    })
    passed, lr = ok("POST /api/auth/login (admin, new pw -> 200)", s, r, 200, key="access_token")
    if passed:
        state["admin_token"] = lr["access_token"]
        # Update local var so subsequent sections that use admin_password still work
        admin_password = admin_new_pw
else:
    skip("§13 password change", "no admin token or email")


# ── §14  Password reset token lifecycle ──────────────────────────────────────
section("§14  Password reset token lifecycle (reset-password endpoint)")

# Fake token / weak password validation paths.
s, r = req("POST", "/api/auth/reset-password", {
    "token":        "fakefakefakefakefakefakefakefakefake",
    "new_password": "ValidPass1!",
})
ok("POST /reset-password (invalid token -> 410)", s, r, 410)

# new_password below Pydantic min_length=8 -> 422
s, r = req("POST", "/api/auth/reset-password", {
    "token":        "fakefakefakefakefakefakefakefakefake",
    "new_password": "S1!",
})
ok("POST /reset-password (new_password too short -> 422)", s, r, 422)

# Token below Pydantic min_length=10 -> 422
s, r = req("POST", "/api/auth/reset-password", {
    "token":        "short",
    "new_password": "ValidPass1!",
})
ok("POST /reset-password (token too short -> 422)", s, r, 422)


# ── §15  Privilege escalation guards ─────────────────────────────────────────
section("§15  Privilege escalation guards")

# 15a. Teacher token cannot list users -> 403
if state["teacher_token"]:
    s, r = req("GET", "/api/auth/admin/users", token=state["teacher_token"])
    ok("GET /admin/users (teacher token -> 403)", s, r, 403)
else:
    skip("§15a teacher->admin guard", "no teacher token")

# 15b. Admin cannot view a super_admin account via GET /admin/users/{id} -> 403
if state["admin_token"] and state["super_admin_token"]:
    sa_check = req("GET", "/api/auth/admin/users",
                   token=state["super_admin_token"],
                   params={"role": "super_admin", "limit": 5})
    _b = sa_check[1]
    sa_list = _b["items"] if isinstance(_b, dict) and "items" in _b else (_b if isinstance(_b, list) else [])
    if sa_list:
        sa_id = sa_list[0]["id"]
        s, r = req("GET", f"/api/auth/admin/users/{sa_id}", token=state["admin_token"])
        ok("GET /admin/users/{super_admin_id} (admin token -> 403)", s, r, 403)
    else:
        skip("§15b admin-cannot-see-SA", "could not determine super_admin id")
else:
    skip("§15b admin-cannot-see-SA", "need both admin and super_admin tokens")

# 15c. Admin cannot modify another admin's account -> 403
if state["admin_token"] and state["super_admin_token"]:
    second_admin_email = f"admin2_{UID}@example.com"
    s2, r2 = req("POST", "/api/auth/admin/teacher-invites",
                 {"email": second_admin_email, "role": "admin"},
                 token=state["super_admin_token"])
    if s2 == 201:
        tok2 = r2["invite_url"].split("?token=")[-1]
        s2, r2 = req("POST", "/api/auth/teacher-invites/accept", {
            "token": tok2, "full_name": "Admin Two", "password": "AdminTwo1!",
        })
        if s2 == 201:
            second_admin_id = r2["id"]
            s, r = req("PATCH", f"/api/auth/admin/users/{second_admin_id}",
                       {"full_name": "Hacked Admin"},
                       token=state["admin_token"])
            ok("PATCH /admin/users/{admin_id} (admin modifies admin -> 403)", s, r, 403)
        else:
            skip("§15c admin-cannot-modify-admin", "second admin acceptance failed")
    else:
        skip("§15c admin-cannot-modify-admin", "could not create second admin invite")
else:
    skip("§15c admin-cannot-modify-admin", "need admin and super_admin tokens")

# 15d. Admin cannot modify their own account via admin route -> 409
if state["admin_token"] and state.get("admin_id"):
    s, r = req("PATCH", f"/api/auth/admin/users/{state['admin_id']}",
               {"full_name": "Self Edit"}, token=state["admin_token"])
    ok("PATCH /admin/users (self -> 409)", s, r, 409)
else:
    skip("§15d admin-modify-self", "no admin token or admin_id")


# ── §16  Admin user-management tools ─────────────────────────────────────────
section("§16  Admin tools (teacher-invite list/revoke, direct user creation)")

# 16a/b. List teacher invites
if state["super_admin_token"]:
    s, r = req("GET", "/api/auth/admin/teacher-invites", token=state["super_admin_token"])
    ok("GET /admin/teacher-invites -> 200", s, r, 200)

    s, r = req("GET", "/api/auth/admin/teacher-invites",
               params={"pending_only": "true"}, token=state["super_admin_token"])
    ok("GET /admin/teacher-invites?pending_only=true -> 200", s, r, 200)
else:
    skip("§16a-b teacher-invite list", "no super_admin token")

# 16c. Create a teacher invite then revoke it before use -> 204
if state["super_admin_token"]:
    revoke_email = f"revoke_{UID}@example.com"
    s, r = req("POST", "/api/auth/admin/teacher-invites",
               {"email": revoke_email, "role": "teacher"},
               token=state["super_admin_token"])
    if s == 201:
        revoke_invite_id = r["id"]
        s, r = req("DELETE", f"/api/auth/admin/teacher-invites/{revoke_invite_id}",
                   token=state["super_admin_token"])
        ok("DELETE /admin/teacher-invites/{id} (revoke pending -> 204)", s, r, 204)
    else:
        skip("§16c revoke teacher-invite", f"invite creation returned {s}")
else:
    skip("§16c revoke teacher-invite", "no super_admin token")

# 16d. Direct user creation (POST /admin/users)
if state["super_admin_token"]:
    direct_email = f"direct_{UID}@example.com"

    s, r = req("POST", "/api/auth/admin/users", {
        "email":     direct_email,
        "password":  "DirectPass1!",
        "full_name": "Direct Teacher",
        "role":      "teacher",
    }, token=state["super_admin_token"])
    ok("POST /admin/users (super_admin creates teacher -> 201)", s, r, 201,
       key="role", expected_val="teacher")

    # Cannot create a student via this endpoint -> 422 (Pydantic schema rejects 'student')
    s, r = req("POST", "/api/auth/admin/users", {
        "email":     f"student_direct_{UID}@example.com",
        "password":  "DirectPass1!",
        "full_name": "Direct Student",
        "role":      "student",
    }, token=state["super_admin_token"])
    ok("POST /admin/users (student role -> 422 schema-rejected)", s, r, 422)

    # Admin (not super_admin) cannot create an admin directly -> 403
    if state["admin_token"]:
        s, r = req("POST", "/api/auth/admin/users", {
            "email":     f"admin_direct_{UID}@example.com",
            "password":  "DirectPass1!",
            "full_name": "Direct Admin",
            "role":      "admin",
        }, token=state["admin_token"])
        ok("POST /admin/users (admin creates admin -> 403)", s, r, 403)
else:
    skip("§16d direct user creation", "no super_admin token")

# 16e. On-demand token cleanup -> 200
if state["super_admin_token"]:
    s, r = req("DELETE", "/api/auth/admin/cleanup-tokens", token=state["super_admin_token"])
    ok("DELETE /admin/cleanup-tokens -> 200", s, r, 200)
else:
    skip("§16e token cleanup", "no super_admin token")


# ── §17  GDPR account erasure ────────────────────────────────────────────────
section("§17  GDPR account erasure (DELETE /users/me)")

# 17a. Create a throwaway teacher account to erase (we don't want to erase the
# teacher_id we still depend on for §15 / future runs).
erasure_email   = f"erasure_{UID}@example.com"
erasure_pw      = "ErasurePass1!"
erasure_token   = None
if state["super_admin_token"]:
    s, r = req("POST", "/api/auth/admin/users", {
        "email":     erasure_email,
        "password":  erasure_pw,
        "full_name": "Erasure Target",
        "role":      "teacher",
    }, token=state["super_admin_token"])
    if s == 201:
        time.sleep(2)
        s2, r2 = req("POST", "/api/auth/login",
                     {"email": erasure_email, "password": erasure_pw})
        if s2 == 200:
            erasure_token = r2["access_token"]

if erasure_token:
    s, r = req("DELETE", "/api/auth/users/me", token=erasure_token)
    ok("DELETE /api/auth/users/me (teacher) -> 204", s, r, 204)

    time.sleep(0.5)

    s, r = req("GET", "/api/auth/me", token=erasure_token)
    ok("GET /api/auth/me (erased account token -> 401)", s, r, 401)
else:
    skip("§17a-b account erasure", "could not create erasure target")

# 17c. Last super_admin is protected — cannot erase themselves -> 409
if state["super_admin_token"]:
    sa_check = req("GET", "/api/auth/admin/users",
                   token=state["super_admin_token"],
                   params={"role": "super_admin", "limit": 100})
    _b = sa_check[1]
    super_admins = _b["items"] if isinstance(_b, dict) and "items" in _b else (_b if isinstance(_b, list) else [])
    if len(super_admins) == 1:
        s, r = req("DELETE", "/api/auth/users/me", token=state["super_admin_token"])
        ok("DELETE /api/auth/users/me (last super_admin -> 409)", s, r, 409)
    else:
        skip("§17c last-super_admin protection",
             f"{len(super_admins)} super_admins exist - only valid when exactly 1")
else:
    skip("§17c super_admin erasure protection", "no super_admin token")


# ── Results ───────────────────────────────────────────────────────────────────
total = PASS + FAIL
print("\n" + "=" * 60)
print(f"  Results : {PASS}/{total} passed   {SKIP} skipped")
if FAIL == 0:
    print("  All tests passed - auth service is production-ready!")
else:
    print(f"  {FAIL} test(s) failed:")
    for f in SECTION_FAILS:
        print(f"       * {f}")
print("=" * 60)
sys.exit(0 if FAIL == 0 else 1)
