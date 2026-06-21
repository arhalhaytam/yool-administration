# STT v2 Production Runbook

This runbook covers operational checks, alert thresholds, and recovery steps
for the STT finalization pipeline.

## 1) Health Checks

Use STT health endpoint:

- `GET /api/stt/health` (through nginx)
- direct container: `GET http://stt:8003/health`

Expected fields:

- `status`: currently `ok`
- `models_loaded`: should be `true` after startup warmup
- `finalize_worker_running`: should be `true`
- `queues.queued`: pending jobs
- `queues.processing`: in-flight jobs
- `queues.dead_letter`: permanently failed jobs
- `queue_error`: should be `null`

## 2) Alert Thresholds (Recommended)

Treat these as initial defaults; tune with real traffic:

- `finalize_worker_running == false` for > 60s -> **critical**
- `queue_error != null` for > 60s -> **critical**
- `queues.dead_letter > 0` -> **high**
- `queues.queued > 50` for > 5 min -> **high**
- `queues.processing > 20` for > 5 min -> **high**

## 3) Quick Triage Flow

1. Check STT logs:
   - `docker compose logs -f stt`
2. Check queue sizes:
   - `redis-cli LLEN stt:jobs`
   - `redis-cli LLEN stt:jobs:processing`
   - `redis-cli LLEN stt:jobs:dlq`
3. Verify worker task status:
   - `GET /api/stt/health` and inspect `finalize_worker_running`
4. Validate session states for affected IDs:
   - `processing` that never ends -> inspect job queues and logs
   - `failed` with transcripts present -> use retry endpoint

## 4) DLQ Recovery

When `stt:jobs:dlq` is non-zero:

1. Inspect one payload first:
   - `redis-cli LINDEX stt:jobs:dlq 0`
2. If root cause is fixed, replay cautiously:
   - move one job at a time from DLQ -> main queue
   - example (manual):
     - `redis-cli LPOP stt:jobs:dlq` (copy payload)
     - `redis-cli RPUSH stt:jobs '<payload-json>'`
3. Monitor:
   - `queues.processing`, `queues.dead_letter`
   - STT logs for `finalize_worker.job_done` vs `job_failed`

Do not bulk replay DLQ until a single replay succeeds.

### Admin API alternatives (RBAC + audited)

For controlled operations without direct Redis shell access:

- Inspect queue:
  - `GET /api/stt/admin/finalize-queue`
  - optional samples: `?include_dlq_samples=true&dlq_sample_limit=3`
- Requeue dead-letter jobs:
  - `POST /api/stt/admin/finalize-queue/requeue-dlq?limit=10`

These endpoints require admin/super-admin auth and write audit entries.

## 5) Common Failure Modes

- **Redis pub/sub end signal missed**
  - STT stream uses DB status fallback (`PROCESSING`) to infer stop.
- **Worker crash mid-job**
  - jobs in `stt:jobs:processing` are requeued on worker startup.
- **Duplicate finalize attempts / reconnect races**
  - summary writes are idempotent and race-safe on unique conflicts.
- **LLM returns empty topics**
  - worker refuses `DONE`, marks session as `FAILED`.

## 6) Manual Session Recovery

If a session is `FAILED` and transcripts exist:

- `POST /api/stt/sessions/{session_id}/retry`

Expected outcomes:

- `200` success -> summary created, status transitions to `DONE`
- `400/409/503` -> investigate logs, transcript length, or external model quota

## 7) Safe Restart Procedure

1. Confirm queue depths (`jobs`, `processing`, `dlq`)
2. Restart STT service:
   - `docker compose restart stt`
3. Re-check `/health`:
   - worker running, no queue error
4. Watch logs for recovered jobs and processing completion.
