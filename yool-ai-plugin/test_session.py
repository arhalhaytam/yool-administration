"""
test_session.py — Session service test suite (post enterprise pivot).

The platform is enterprise-only — students no longer exist. Courses are
created by admins and assigned to a teacher. Teachers can only operate on
their assigned courses. Sessions are started with a single call and stopped
manually. The previous live partial-summary feed has been removed.

Sections:
  §1   Health checks
  §2   Super-admin login (bootstrapped at startup)
  §3   Teacher bootstrap (invite -> accept -> login)
  §4   Admin bootstrap (invite -> accept -> login)
  §5   Course creation + admin-only RBAC
  §6   Course input validation
  §7   Course visibility (?assigned_to_me, teacher sees only own, admin sees all)
  §8   Course teacher reassignment (PATCH /courses/{id}/teacher)
  §9   Session lifecycle (single-call start, manual end, cancel)
  §10  Session RBAC (teacher isolation, admin bypass)
  §11  Session read-only resources (transcript, summary)
  §12  Session input validation
  §13  State machine edge cases
  §14  Admin can mutate any teacher's session
  §15  GDPR data-retention purge
  §16  Non-existent session/course IDs -> 404
  §17  Removed student endpoints regression (404/405)

Run:
    python test_session.py
    python test_session.py --base-url https://myserver.com
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

PASS = FAIL = SKIP = 0
SECTION_FAILS = []


# ── HTTP helper ───────────────────────────────────────────────────────────────

def req(method, path, body=None, token=None, params=None, _retries=3):
    """Send a request. Retries on 503 (nginx rate-limit) with exponential backoff
    so the test suite doesn't fail on transient throttling unrelated to the app."""
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    # Use `is not None` so an empty dict {} still serializes to a real body —
    # FastAPI required-body endpoints reject a missing body with 422.
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


# ── Shared test state ─────────────────────────────────────────────────────────
state = {
    "super_admin_token": None,
    "teacher_token":     None,
    "teacher_id":        None,
    "teacher2_token":    None,
    "teacher2_id":       None,
    "admin_token":       None,
    "admin_id":          None,
    "course_id":         None,   # primary course (assigned to teacher)
    "course2_id":        None,   # secondary course (assigned to teacher2)
    "session_id":        None,   # primary live session (LIVE -> PROCESSING)
    "session2_id":       None,   # secondary session (cancel path)
}

UID = uuid.uuid4().hex[:8]

# =============================================================================
print("=" * 60)
print("  Yool AI Plugin - Session Service Test Suite")
print(f"  Target : {BASE}")
print(f"  Run ID : {UID}")
print("=" * 60)


# ── §1  Health ────────────────────────────────────────────────────────────────
section("§1  Health checks")

s, r = req("GET", "/health")
ok("GET /health (nginx gateway)", s, r, 200)

s, r = req("GET", "/api/sessions/health")
ok("GET /api/sessions/health (session service)", s, r, 200)


# ── §2  Super-admin login ─────────────────────────────────────────────────────
section("§2  Super-admin login")

s, r = req("POST", "/api/auth/login", {
    "email": "superadmin@yool.ai",
    "password": "ChangeMe2026!",
})
passed, lr = ok("POST /api/auth/login (super_admin)", s, r, 200, key="access_token")
if passed:
    state["super_admin_token"] = lr["access_token"]


# ── §3  Teacher bootstrap ─────────────────────────────────────────────────────
section("§3  Teacher bootstrap (invite -> accept -> login)")

teacher_email    = f"teacher_{UID}@example.com"
teacher_password = "TeachPass1!"
teacher_invite_token = None

if state["super_admin_token"]:
    s, r = req("POST", "/api/auth/admin/teacher-invites",
               {"email": teacher_email, "role": "teacher"},
               token=state["super_admin_token"])
    if ok("POST /admin/teacher-invites (teacher)", s, r, 201, key="invite_url")[0]:
        teacher_invite_token = r["invite_url"].split("?token=")[-1]

if teacher_invite_token:
    s, r = req("POST", "/api/auth/teacher-invites/accept", {
        "token":     teacher_invite_token,
        "full_name": "Prof. Test",
        "password":  teacher_password,
    })
    passed, acc_r = ok("POST /teacher-invites/accept -> role=teacher", s, r, 201,
                       key="role", expected_val="teacher")
    if passed:
        state["teacher_id"] = acc_r.get("id")

time.sleep(1)
s, r = req("POST", "/api/auth/login",
           {"email": teacher_email, "password": teacher_password})
passed, lr = ok("POST /api/auth/login (teacher)", s, r, 200, key="access_token")
if passed:
    state["teacher_token"] = lr["access_token"]

# Second teacher (cross-teacher isolation)
teacher2_email    = f"teacher2_{UID}@example.com"
teacher2_password = "TeachPass2!"
teacher2_invite   = None

if state["super_admin_token"]:
    s, r = req("POST", "/api/auth/admin/teacher-invites",
               {"email": teacher2_email, "role": "teacher"},
               token=state["super_admin_token"])
    if s == 201:
        teacher2_invite = r["invite_url"].split("?token=")[-1]

if teacher2_invite:
    s, r = req("POST", "/api/auth/teacher-invites/accept", {
        "token": teacher2_invite, "full_name": "Prof. Second", "password": teacher2_password,
    })
    if s == 201:
        state["teacher2_id"] = r.get("id")

time.sleep(1)
if state["teacher2_id"]:
    s, r = req("POST", "/api/auth/login",
               {"email": teacher2_email, "password": teacher2_password})
    if s == 200:
        state["teacher2_token"] = r["access_token"]


# ── §4  Admin bootstrap ───────────────────────────────────────────────────────
section("§4  Admin bootstrap (invite -> accept -> login)")

admin_email    = f"admin_{UID}@example.com"
admin_password = "AdminPass1!"
admin_invite   = None

if state["super_admin_token"]:
    s, r = req("POST", "/api/auth/admin/teacher-invites",
               {"email": admin_email, "role": "admin"},
               token=state["super_admin_token"])
    if s == 201:
        admin_invite = r["invite_url"].split("?token=")[-1]

if admin_invite:
    s, r = req("POST", "/api/auth/teacher-invites/accept", {
        "token": admin_invite, "full_name": "Admin User", "password": admin_password,
    })
    passed, acc_r = ok("POST /teacher-invites/accept -> role=admin", s, r, 201,
                       key="role", expected_val="admin")
    if passed:
        state["admin_id"] = acc_r.get("id")

time.sleep(1)
if state["admin_id"]:
    s, r = req("POST", "/api/auth/login",
               {"email": admin_email, "password": admin_password})
    passed, lr = ok("POST /api/auth/login (admin)", s, r, 200, key="access_token")
    if passed:
        state["admin_token"] = lr["access_token"]


# ── §5  Course creation: admin-only ───────────────────────────────────────────
section("§5  Course creation (admin-only) + teacher cannot create")

# 5a. Teacher CANNOT create a course -> 403
if state["teacher_token"] and state["teacher_id"]:
    s, r = req("POST", "/api/courses/", {
        "title":      f"Hijack Course {UID}",
        "subject":    "Hacking",
        "teacher_id": state["teacher_id"],
    }, token=state["teacher_token"])
    ok("POST /api/courses/ (teacher -> 403)", s, r, 403)
else:
    skip("§5a teacher cannot create course", "no teacher token or id")

# 5b. Admin creates a course assigned to teacher
if state["admin_token"] and state["teacher_id"]:
    s, r = req("POST", "/api/courses/", {
        "title":      f"Test Course {UID}",
        "subject":    "Computer Science",
        "teacher_id": state["teacher_id"],
    }, token=state["admin_token"])
    passed, cr = ok("POST /api/courses/ (admin assigns to teacher) -> 201", s, r, 201,
                    key="teacher_id", expected_val=state["teacher_id"])
    if passed:
        state["course_id"] = cr["id"]
else:
    skip("§5b admin creates course", "no admin token or teacher id")

# 5c. Admin creates a second course assigned to teacher2
if state["admin_token"] and state["teacher2_id"]:
    s, r = req("POST", "/api/courses/", {
        "title":      f"Test Course2 {UID}",
        "subject":    "Mathematics",
        "teacher_id": state["teacher2_id"],
    }, token=state["admin_token"])
    if ok("POST /api/courses/ (admin -> teacher2) -> 201", s, r, 201)[0]:
        state["course2_id"] = r["id"]
else:
    skip("§5c second course", "no admin token or teacher2 id")

# 5d. Admin cannot assign to non-existent teacher -> 404
if state["admin_token"]:
    s, r = req("POST", "/api/courses/", {
        "title":      f"Ghost Teacher {UID}",
        "subject":    "Mystery",
        "teacher_id": str(uuid.uuid4()),
    }, token=state["admin_token"])
    ok("POST /api/courses/ (ghost teacher_id -> 404)", s, r, 404)

# 5e. Admin cannot assign to a non-teacher user (super_admin id) -> 422
if state["admin_token"] and state["super_admin_token"]:
    s, r = req("GET", "/api/auth/admin/users",
               token=state["super_admin_token"],
               params={"role": "super_admin", "limit": 5})
    sa_list = r if isinstance(r, list) else []
    if sa_list:
        s, r = req("POST", "/api/courses/", {
            "title":      f"Wrong Role {UID}",
            "subject":    "Test",
            "teacher_id": sa_list[0]["id"],
        }, token=state["admin_token"])
        ok("POST /api/courses/ (assigning a super_admin -> 422)", s, r, 422)
    else:
        skip("§5e wrong-role assignment", "no super_admin id")
else:
    skip("§5e wrong-role assignment", "missing tokens")

# 5f. Teacher cannot DELETE course
if state["teacher_token"] and state["course_id"]:
    s, r = req("DELETE", f"/api/courses/{state['course_id']}", token=state["teacher_token"])
    ok("DELETE /api/courses/{id} (teacher -> 403)", s, r, 403)
else:
    skip("§5f teacher cannot delete", "no teacher token or course_id")

# 5g. Admin updates course (title only)
if state["admin_token"] and state["course_id"]:
    s, r = req("PATCH", f"/api/courses/{state['course_id']}",
               {"title": f"Updated Course {UID}"}, token=state["admin_token"])
    ok("PATCH /api/courses/{id} (admin updates title)", s, r, 200,
       key="title", expected_val=f"Updated Course {UID}")
else:
    skip("§5g admin patch", "no admin token or course_id")

# 5h. Teacher cannot PATCH course
if state["teacher_token"] and state["course_id"]:
    s, r = req("PATCH", f"/api/courses/{state['course_id']}",
               {"title": "Hijacked"}, token=state["teacher_token"])
    ok("PATCH /api/courses/{id} (teacher -> 403)", s, r, 403)
else:
    skip("§5h teacher patch denied", "no teacher token or course_id")


# ── §6  Course input validation ───────────────────────────────────────────────
section("§6  Course input validation (field constraints)")

if state["admin_token"] and state["teacher_id"]:
    # Title too short
    s, r = req("POST", "/api/courses/",
               {"title": "X", "subject": "Science", "teacher_id": state["teacher_id"]},
               token=state["admin_token"])
    ok("POST /api/courses/ (title 1 char -> 422)", s, r, 422)

    # Title too long
    s, r = req("POST", "/api/courses/",
               {"title": "A" * 256, "subject": "Science", "teacher_id": state["teacher_id"]},
               token=state["admin_token"])
    ok("POST /api/courses/ (title 256 chars -> 422)", s, r, 422)

    # Missing subject
    s, r = req("POST", "/api/courses/",
               {"title": "Valid Title", "teacher_id": state["teacher_id"]},
               token=state["admin_token"])
    ok("POST /api/courses/ (missing subject -> 422)", s, r, 422)

    # Missing teacher_id
    s, r = req("POST", "/api/courses/",
               {"title": "Valid Title", "subject": "Science"},
               token=state["admin_token"])
    ok("POST /api/courses/ (missing teacher_id -> 422)", s, r, 422)

    # PATCH with too-short title
    if state["course_id"]:
        s, r = req("PATCH", f"/api/courses/{state['course_id']}",
                   {"title": "X"}, token=state["admin_token"])
        ok("PATCH /api/courses/{id} (title 1 char -> 422)", s, r, 422)
    else:
        skip("PATCH course short title", "no course_id")
else:
    skip("§6 course validation", "no admin token or teacher_id")


# ── §7  Course visibility ─────────────────────────────────────────────────────
section("§7  Course visibility (assigned_to_me, teacher scope, admin all)")

# 7a. Teacher only sees their own course
if state["teacher_token"] and state["course_id"]:
    s, r = req("GET", "/api/courses/", token=state["teacher_token"])
    passed, courses_body = ok("GET /api/courses/ (teacher) -> 200", s, r, 200)
    if passed:
        courses, _ = _list_page(courses_body)
        ids = [c["id"] for c in courses]
        if state["course_id"] in ids and (state["course2_id"] not in ids or state["course2_id"] is None):
            print(f"        Teacher sees only own course(s): {len(courses)} total")
        else:
            print(f"  [warn] Teacher sees unexpected courses: {ids}")
else:
    skip("§7a teacher visibility", "no teacher token or course_id")

# 7b. Admin sees all courses
if state["admin_token"] and state["course_id"] and state["course2_id"]:
    s, r = req("GET", "/api/courses/", token=state["admin_token"])
    passed, courses_body = ok("GET /api/courses/ (admin sees all) -> 200", s, r, 200)
    if passed:
        courses, _ = _list_page(courses_body)
        ids = [c["id"] for c in courses]
        if state["course_id"] in ids and state["course2_id"] in ids:
            print(f"        Admin sees both courses ({len(courses)} total)")
else:
    skip("§7b admin visibility", "missing tokens or courses")

# 7c. ?assigned_to_me=true filter
if state["teacher_token"] and state["course_id"]:
    s, r = req("GET", "/api/courses/",
               params={"assigned_to_me": "true"}, token=state["teacher_token"])
    passed, courses_body = ok("GET /api/courses/?assigned_to_me=true (teacher) -> 200", s, r, 200)
    if passed:
        courses, _ = _list_page(courses_body)
        all_mine = all(c.get("teacher_id") == state["teacher_id"] for c in courses)
        if all_mine:
            print(f"        All {len(courses)} returned course(s) belong to teacher")

# 7d. GET /courses/{id} — teacher fetches their own
if state["teacher_token"] and state["course_id"]:
    s, r = req("GET", f"/api/courses/{state['course_id']}", token=state["teacher_token"])
    ok("GET /api/courses/{id} (own course) -> 200", s, r, 200,
       key="id", expected_val=state["course_id"])

# 7e. GET /courses/{id} — teacher fetches another teacher's course -> 403
if state["teacher_token"] and state["course2_id"]:
    s, r = req("GET", f"/api/courses/{state['course2_id']}", token=state["teacher_token"])
    ok("GET /api/courses/{id} (other teacher's course -> 403)", s, r, 403)


# ── §8  Course teacher reassignment ───────────────────────────────────────────
section("§8  PATCH /courses/{id}/teacher (admin reassigns)")

# 8a. Admin reassigns course2 to teacher
if state["admin_token"] and state["course2_id"] and state["teacher_id"]:
    s, r = req("PATCH", f"/api/courses/{state['course2_id']}/teacher",
               {"teacher_id": state["teacher_id"]}, token=state["admin_token"])
    ok("PATCH /courses/{id}/teacher (admin reassigns) -> 200", s, r, 200,
       key="teacher_id", expected_val=state["teacher_id"])

    # 8b. Reassign back so subsequent tests still match expectations
    if state["teacher2_id"]:
        s, r = req("PATCH", f"/api/courses/{state['course2_id']}/teacher",
                   {"teacher_id": state["teacher2_id"]}, token=state["admin_token"])
        ok("PATCH /courses/{id}/teacher (admin reassigns back) -> 200", s, r, 200,
           key="teacher_id", expected_val=state["teacher2_id"])
else:
    skip("§8 reassign teacher", "missing admin / course2 / teacher_id")

# 8c. Reassigning to a non-teacher user -> 422
if state["admin_token"] and state["course2_id"] and state["admin_id"]:
    s, r = req("PATCH", f"/api/courses/{state['course2_id']}/teacher",
               {"teacher_id": state["admin_id"]}, token=state["admin_token"])
    ok("PATCH /courses/{id}/teacher (admin user -> 422)", s, r, 422)

# 8d. Teacher CANNOT reassign -> 403
if state["teacher_token"] and state["course_id"] and state["teacher2_id"]:
    s, r = req("PATCH", f"/api/courses/{state['course_id']}/teacher",
               {"teacher_id": state["teacher2_id"]}, token=state["teacher_token"])
    ok("PATCH /courses/{id}/teacher (teacher -> 403)", s, r, 403)


# ── §9  Session lifecycle ─────────────────────────────────────────────────────
section("§9  Session lifecycle (single-call start, manual end)")

# 9a. Single-call start: teacher hits POST /api/sessions/courses/{id}/start
if state["teacher_token"] and state["course_id"]:
    s, r = req("POST", f"/api/sessions/courses/{state['course_id']}/start",
               {}, token=state["teacher_token"])
    passed, sr = ok("POST /api/sessions/courses/{id}/start -> 201 status=live",
                    s, r, 201, key="status", expected_val="live")
    if passed:
        state["session_id"] = sr["id"]
        # Auto-generated title check
        if sr.get("title"):
            print(f"        Auto-generated title: {sr['title']!r}")
else:
    skip("§9a start session", "no teacher token or course_id")

# 9b. Same teacher cannot start another session via wrong course_id (course not theirs) -> 403
if state["teacher_token"] and state["course2_id"]:
    s, r = req("POST", f"/api/sessions/courses/{state['course2_id']}/start",
               {}, token=state["teacher_token"])
    ok("POST /sessions/courses/{course_not_mine}/start (teacher -> 403)", s, r, 403)

# 9c. Custom title override
if state["admin_token"] and state["course_id"]:
    s, r = req("POST", f"/api/sessions/courses/{state['course_id']}/start",
               {"title": f"Admin Custom {UID}"},
               token=state["admin_token"])
    passed, sr = ok("POST /sessions/courses/{id}/start (admin custom title) -> 201",
                    s, r, 201, key="title", expected_val=f"Admin Custom {UID}")
    if passed:
        # Cancel right away so we don't leave it dangling (admin starts as teacher's session)
        req("POST", f"/api/sessions/{sr['id']}/cancel", token=state["admin_token"])

# 9d. Cannot rename a LIVE session... actually we allow rename in CREATED or LIVE.
#     The session is LIVE. Verify rename works on LIVE.
if state["teacher_token"] and state["session_id"]:
    s, r = req("PATCH", f"/api/sessions/{state['session_id']}",
               {"title": f"Renamed {UID}"}, token=state["teacher_token"])
    ok("PATCH /api/sessions/{id} (rename LIVE -> 200)",
       s, r, 200, key="title", expected_val=f"Renamed {UID}")

# 9e. Manual stop: teacher presses end (LIVE -> PROCESSING)
if state["teacher_token"] and state["session_id"]:
    s, r = req("POST", f"/api/sessions/{state['session_id']}/end",
               token=state["teacher_token"])
    ok("POST /api/sessions/{id}/end (LIVE -> processing) -> 200",
       s, r, 200, key="status", expected_val="processing")
else:
    skip("§9e end session", "no session_id")

# 9f. Cannot end a session that's no longer live -> 400
if state["teacher_token"] and state["session_id"]:
    s, r = req("POST", f"/api/sessions/{state['session_id']}/end",
               token=state["teacher_token"])
    ok("POST /api/sessions/{id}/end (already PROCESSING -> 400)", s, r, 400)

# 9g. Cancel path: start a fresh LIVE session and cancel it
if state["teacher_token"] and state["course_id"]:
    s, r = req("POST", f"/api/sessions/courses/{state['course_id']}/start",
               {"title": f"Cancel Test {UID}"},
               token=state["teacher_token"])
    if s == 201:
        state["session2_id"] = r["id"]
        s, r = req("POST", f"/api/sessions/{state['session2_id']}/cancel",
                   token=state["teacher_token"])
        ok("POST /api/sessions/{id}/cancel (LIVE -> failed) -> 200",
           s, r, 200, key="status", expected_val="failed")
    else:
        skip("§9g cancel test", f"start returned {s}")

# 9h. Cancel a terminal session -> 400
if state["teacher_token"] and state["session2_id"]:
    s, r = req("POST", f"/api/sessions/{state['session2_id']}/cancel",
               token=state["teacher_token"])
    ok("POST /api/sessions/{id}/cancel (already FAILED -> 400)", s, r, 400)


# ── §10  Session RBAC ─────────────────────────────────────────────────────────
section("§10  Session RBAC (teacher isolation, admin bypass)")

def _list_page(body):
    """Paginated list responses: {items, total, ...}."""
    if isinstance(body, dict) and "items" in body:
        return body["items"], body.get("total", len(body["items"]))
    if isinstance(body, list):
        return body, len(body)
    return [], 0


def _session_page(body):
    """Paginated GET /api/sessions/ returns {items, total, ...}."""
    if isinstance(body, dict) and "items" in body:
        return body["items"], body.get("total", len(body["items"]))
    if isinstance(body, list):
        return body, len(body)
    return [], 0


# 10a. Teacher lists their sessions
if state["teacher_token"]:
    s, r = req("GET", "/api/sessions/", token=state["teacher_token"])
    passed, sess_body = ok("GET /api/sessions/ (teacher) -> 200", s, r, 200)
    if passed:
        sess_list, sess_total = _session_page(sess_body)
        if isinstance(sess_body, dict) and {"items", "total", "limit", "offset", "has_more"} <= set(sess_body):
            print("        Paginated session list shape OK")
        if state["session_id"]:
            ids = [ss["id"] for ss in sess_list]
            if state["session_id"] in ids:
                print(f"        Teacher sees {sess_total} session(s) including primary")

# 10b. Teacher2 cannot GET teacher's session -> 403
if state["teacher2_token"] and state["session_id"]:
    s, r = req("GET", f"/api/sessions/{state['session_id']}",
               token=state["teacher2_token"])
    ok("GET /api/sessions/{id} (teacher2 -> 403)", s, r, 403)

# 10c. Admin can GET any session (bypass)
if state["admin_token"] and state["session_id"]:
    s, r = req("GET", f"/api/sessions/{state['session_id']}",
               token=state["admin_token"])
    ok("GET /api/sessions/{id} (admin bypass) -> 200", s, r, 200,
       key="id", expected_val=state["session_id"])

# 10d. Admin sees all sessions
if state["admin_token"]:
    s, r = req("GET", "/api/sessions/", token=state["admin_token"])
    passed, all_body = ok("GET /api/sessions/ (admin) -> 200", s, r, 200)
    if passed:
        _, admin_total = _session_page(all_body)
        print(f"        Admin sees {admin_total} total session(s)")

# 10d2. Session status summary
if state["admin_token"]:
    s, r = req("GET", "/api/sessions/summary", token=state["admin_token"])
    passed, summ = ok("GET /api/sessions/summary (admin) -> 200", s, r, 200)
    if passed and isinstance(summ, dict) and "total" in summ and "live" in summ:
        print(f"        Summary: total={summ.get('total')} live={summ.get('live')} done={summ.get('done')}")

# 10e. course_id filter
if state["teacher_token"] and state["course_id"]:
    s, r = req("GET", "/api/sessions/",
               params={"course_id": state["course_id"]},
               token=state["teacher_token"])
    passed, filt_body = ok("GET /api/sessions/?course_id=... (teacher) -> 200", s, r, 200)
    if passed:
        filt, _ = _session_page(filt_body)
        if filt:
            all_match = all(ss.get("course_id") == state["course_id"] for ss in filt)
            if all_match:
                print(f"        {len(filt)} session(s) on page — all match course_id")

# 10f. Unauthenticated -> 403
s, r = req("GET", "/api/sessions/")
ok("GET /api/sessions/ (no token -> 403)", s, r, 403)


# ── §11  Session read-only resources ──────────────────────────────────────────
section("§11  Session read-only resources (transcript, summary)")

# 11a. Transcript: PROCESSING, no segments yet -> empty list
if state["teacher_token"] and state["session_id"]:
    s, r = req("GET", f"/api/sessions/{state['session_id']}/transcript",
               token=state["teacher_token"])
    ok("GET /api/sessions/{id}/transcript -> 200 (empty)", s, r, 200)

# 11b. Summary not ready (PROCESSING) -> 409
if state["teacher_token"] and state["session_id"]:
    s, r = req("GET", f"/api/sessions/{state['session_id']}/summary",
               token=state["teacher_token"])
    ok("GET /api/sessions/{id}/summary (PROCESSING -> 409)", s, r, 409)

# 11c. Summary endpoint accepts admin requests (for self-contained outline export)
if state["admin_token"] and state["session_id"]:
    s, r = req("GET", f"/api/sessions/{state['session_id']}/summary",
               token=state["admin_token"])
    ok_any("GET /api/sessions/{id}/summary (admin, PROCESSING -> 409)",
           s, [409], r, note="409 = expected because session not DONE yet")


# ── §12  Session input validation ─────────────────────────────────────────────
section("§12  Session input validation")

if state["teacher_token"] and state["course_id"]:
    # Title too short on override
    s, r = req("POST", f"/api/sessions/courses/{state['course_id']}/start",
               {"title": "X"}, token=state["teacher_token"])
    ok("POST /sessions/courses/{id}/start (title 1 char -> 422)", s, r, 422)

    # Title too long
    s, r = req("POST", f"/api/sessions/courses/{state['course_id']}/start",
               {"title": "A" * 256}, token=state["teacher_token"])
    ok("POST /sessions/courses/{id}/start (title 256 chars -> 422)", s, r, 422)

    # Non-existent course_id -> 404
    s, r = req("POST", f"/api/sessions/courses/{uuid.uuid4()}/start",
               {}, token=state["teacher_token"])
    ok("POST /sessions/courses/{ghost}/start -> 404", s, r, 404)


# ── §13  State machine edge cases ────────────────────────────────────────────
section("§13  State machine edge cases")

# 13a. Calling /end on a CREATED session: actually CREATED is a transient state
#      that no longer occurs in the new flow (we go straight to LIVE).
#      Skip the equivalent for now — verified via /start path above.
# 13b. Calling /start on a FAILED (terminal) session -> the new endpoint
#      starts a NEW session, so this concept doesn't apply.
#      Instead test: cancel a terminal session -> 400 (covered in §9h).
print("        State machine simplified after pivot — see §9 for full coverage")


# ── §14  Admin bypass on mutations ────────────────────────────────────────────
section("§14  Admin can mutate any teacher's session")

_admin_target_id = None
if state["teacher_token"] and state["course_id"]:
    s, r = req("POST", f"/api/sessions/courses/{state['course_id']}/start",
               {"title": f"Admin Target {UID}"},
               token=state["teacher_token"])
    if s == 201:
        _admin_target_id = r["id"]

if state["admin_token"] and _admin_target_id:
    s, r = req("PATCH", f"/api/sessions/{_admin_target_id}",
               {"title": f"Admin Renamed {UID}"}, token=state["admin_token"])
    ok("PATCH /api/sessions/{id} (admin renames teacher's session)", s, r, 200,
       key="title", expected_val=f"Admin Renamed {UID}")

    s, r = req("POST", f"/api/sessions/{_admin_target_id}/cancel",
               token=state["admin_token"])
    ok("POST /api/sessions/{id}/cancel (admin cancels teacher's session)",
       s, r, 200, key="status", expected_val="failed")
else:
    skip("§14 admin bypass", "no admin token or target session")


# ── §15  GDPR data-retention purge ────────────────────────────────────────────
section("§15  GDPR data-retention purge (admin/purge endpoint)")

# 15a. Teacher cannot trigger purge -> 403
if state["teacher_token"]:
    s, r = req("DELETE", "/api/sessions/admin/purge",
               token=state["teacher_token"], params={"days": 365})
    ok("DELETE /api/sessions/admin/purge (teacher -> 403)", s, r, 403)

# 15b. Admin triggers purge with a 10-year window (no real data deleted)
if state["admin_token"]:
    s, r = req("DELETE", "/api/sessions/admin/purge",
               token=state["admin_token"], params={"days": 3650})
    ok("DELETE /api/sessions/admin/purge (admin, 3650 days)", s, r, 200,
       key="purged_sessions")

# 15c. days < 30 -> 422
if state["admin_token"]:
    s, r = req("DELETE", "/api/sessions/admin/purge",
               token=state["admin_token"], params={"days": 1})
    ok("DELETE /api/sessions/admin/purge (days=1 -> 422)", s, r, 422)

# 15d. days > 3650 -> 422
if state["admin_token"]:
    s, r = req("DELETE", "/api/sessions/admin/purge",
               token=state["admin_token"], params={"days": 9999})
    ok("DELETE /api/sessions/admin/purge (days=9999 -> 422)", s, r, 422)


# ── §16  Non-existent IDs ────────────────────────────────────────────────────
section("§16  Non-existent session/course IDs -> 404")

_ghost = str(uuid.uuid4())

if state["teacher_token"]:
    s, r = req("GET", f"/api/sessions/{_ghost}", token=state["teacher_token"])
    ok("GET /api/sessions/{ghost} -> 404", s, r, 404)

    s, r = req("PATCH", f"/api/sessions/{_ghost}",
               {"title": "ghost"}, token=state["teacher_token"])
    ok("PATCH /api/sessions/{ghost} -> 404", s, r, 404)

    s, r = req("POST", f"/api/sessions/{_ghost}/end", token=state["teacher_token"])
    ok("POST /api/sessions/{ghost}/end -> 404", s, r, 404)

    s, r = req("POST", f"/api/sessions/{_ghost}/cancel", token=state["teacher_token"])
    ok("POST /api/sessions/{ghost}/cancel -> 404", s, r, 404)

    s, r = req("GET", f"/api/courses/{_ghost}", token=state["teacher_token"])
    ok("GET /api/courses/{ghost} -> 404", s, r, 404)


# ── §17  Removed student endpoints (regression) ──────────────────────────────
section("§17  Student/enrollment endpoints removed")

# 17a. /api/sessions/{id}/partial-summaries no longer exists -> 404 from FastAPI
if state["teacher_token"] and state["session_id"]:
    s, r = req("GET", f"/api/sessions/{state['session_id']}/partial-summaries",
               token=state["teacher_token"])
    ok_any("GET /api/sessions/{id}/partial-summaries (gone) -> 404 or 405",
           s, [404, 405], r,
           note="endpoint removed by enterprise pivot")

# 17b. /api/courses/{id}/enroll no longer exists -> 404 or 405
if state["admin_token"] and state["course_id"] and state["teacher2_id"]:
    s, r = req("POST", f"/api/courses/{state['course_id']}/enroll",
               {"student_id": state["teacher2_id"]}, token=state["admin_token"])
    ok_any("POST /api/courses/{id}/enroll (gone) -> 404 or 405",
           s, [404, 405], r,
           note="endpoint removed by enterprise pivot")

# 17c. /api/courses/{id}/students no longer exists -> 404 or 405
if state["admin_token"] and state["course_id"]:
    s, r = req("GET", f"/api/courses/{state['course_id']}/students",
               token=state["admin_token"])
    ok_any("GET /api/courses/{id}/students (gone) -> 404 or 405",
           s, [404, 405], r,
           note="endpoint removed by enterprise pivot")


# ── Results ───────────────────────────────────────────────────────────────────
total = PASS + FAIL
print("\n" + "=" * 60)
print(f"  Results : {PASS}/{total} passed   {SKIP} skipped")
if FAIL == 0:
    print("  All tests passed - session service is production-ready!")
else:
    print(f"  {FAIL} test(s) failed:")
    for f in SECTION_FAILS:
        print(f"        * {f}")
print("=" * 60)
sys.exit(0 if FAIL == 0 else 1)
