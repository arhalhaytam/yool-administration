# Integration scope (decision record)

## Current coverage

Automated scripts (run after `docker compose up` or the CI compose merge):

| Script | Focus |
|--------|--------|
| `test_api.py` | Gateway, auth invite, courses, session start/end, query summary status, STT HTTP health |
| `test_session.py` | Course CRUD, RBAC, session lifecycle, purge, removed endpoints |
| `test_auth.py` | Invites, JWT blocklist, refresh rotation, rate limits, GDPR erasure |

CI uses [`docker-compose.ci.yml`](../docker-compose.ci.yml) so the **real STT image is not built**; a tiny stub serves `GET /health` on port 8003 only. That validates routing and regressions in auth/session/query without ML downloads.

## Next integration targets (phased)

1. **STT WebSocket smoke (recommended first)**  
   Minimal client: open `wss://.../api/stt/...` with a valid JWT, send a short silence or tiny PCM chunk, expect orderly close or first server frame. Catches auth-on-WS, nginx upgrade, and startup regressions that HTTP health misses.

2. **Query / summary E2E (second)**  
   Drive a path from **live session → transcript persisted → session DONE (or processing pipeline) → `GET /api/query/sessions/{id}/summary` returns 200**. Depends on how session finalize and workers trigger summarization; implement once that pipeline is stable in dev.

Doing both is the long-term goal; **order above** avoids blocking E2E on LLM quality while still hardening the highest-risk realtime path first.
