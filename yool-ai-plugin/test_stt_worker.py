"""
Focused reliability tests for STT finalize worker queue semantics.

Run:
    python test_stt_worker.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest
from pathlib import Path


# Minimal env required by services/stt/core/config.py at import time.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("HF_TOKEN", "test-hf-token")


REPO_ROOT = Path(__file__).resolve().parent
STT_ROOT = REPO_ROOT / "services" / "stt"
for p in (str(REPO_ROOT), str(STT_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

_IMPORT_ERROR: Exception | None = None
try:
    from pipeline.finalize_worker import (  # noqa: E402
        FinalizeWorker,
        _DLQ_KEY,
        _MAX_JOB_RETRIES,
        _PROCESSING_QUEUE_KEY,
        _QUEUE_KEY,
    )
except Exception as exc:  # pragma: no cover - environment-dependent
    _IMPORT_ERROR = exc
    FinalizeWorker = None  # type: ignore[assignment]
    _QUEUE_KEY = "stt:jobs"
    _PROCESSING_QUEUE_KEY = "stt:jobs:processing"
    _DLQ_KEY = "stt:jobs:dlq"
    _MAX_JOB_RETRIES = 3


class FakeRedis:
    def __init__(self) -> None:
        self.lists: dict[str, list[str]] = {
            _QUEUE_KEY: [],
            _PROCESSING_QUEUE_KEY: [],
            _DLQ_KEY: [],
        }

    async def lpop(self, key: str):
        items = self.lists.setdefault(key, [])
        if not items:
            return None
        return items.pop(0)

    async def rpush(self, key: str, value: str):
        self.lists.setdefault(key, []).append(value)
        return len(self.lists[key])

    async def lrem(self, key: str, count: int, value: str):
        # Minimal behavior needed by worker: remove first matching entry.
        items = self.lists.setdefault(key, [])
        removed = 0
        new_items: list[str] = []
        for item in items:
            if removed < count and item == value:
                removed += 1
                continue
            new_items.append(item)
        self.lists[key] = new_items
        return removed


@unittest.skipIf(_IMPORT_ERROR is not None, f"STT runtime dependencies unavailable: {_IMPORT_ERROR}")
class FinalizeWorkerReliabilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_recover_stuck_jobs_moves_processing_back_to_main_queue(self):
        worker = FinalizeWorker()
        redis = FakeRedis()
        redis.lists[_PROCESSING_QUEUE_KEY] = [
            json.dumps({"session_id": "s1"}),
            json.dumps({"session_id": "s2"}),
        ]

        await worker._recover_stuck_jobs(redis)

        self.assertEqual(redis.lists[_PROCESSING_QUEUE_KEY], [])
        self.assertEqual(len(redis.lists[_QUEUE_KEY]), 2)
        self.assertEqual(json.loads(redis.lists[_QUEUE_KEY][0])["session_id"], "s1")
        self.assertEqual(json.loads(redis.lists[_QUEUE_KEY][1])["session_id"], "s2")

    async def test_failed_job_is_requeued_with_incremented_attempt(self):
        worker = FinalizeWorker()
        redis = FakeRedis()
        raw = json.dumps({"session_id": "abc", "attempt": 0})
        redis.lists[_PROCESSING_QUEUE_KEY] = [raw]

        async def _always_fail(job: dict) -> None:
            raise RuntimeError("boom")

        worker._process_job = _always_fail  # type: ignore[method-assign]

        await worker._process_claimed_job(redis, raw)

        self.assertEqual(redis.lists[_PROCESSING_QUEUE_KEY], [])
        self.assertEqual(len(redis.lists[_QUEUE_KEY]), 1)
        requeued = json.loads(redis.lists[_QUEUE_KEY][0])
        self.assertEqual(requeued["attempt"], 1)
        self.assertIn("last_error", requeued)
        self.assertEqual(redis.lists[_DLQ_KEY], [])

    async def test_job_exceeding_max_retries_goes_to_dead_letter_queue(self):
        worker = FinalizeWorker()
        redis = FakeRedis()
        raw = json.dumps({"session_id": "abc", "attempt": _MAX_JOB_RETRIES})
        redis.lists[_PROCESSING_QUEUE_KEY] = [raw]

        async def _always_fail(job: dict) -> None:
            raise RuntimeError("still failing")

        worker._process_job = _always_fail  # type: ignore[method-assign]

        await worker._process_claimed_job(redis, raw)

        self.assertEqual(redis.lists[_PROCESSING_QUEUE_KEY], [])
        self.assertEqual(redis.lists[_QUEUE_KEY], [])
        self.assertEqual(len(redis.lists[_DLQ_KEY]), 1)
        dead = json.loads(redis.lists[_DLQ_KEY][0])
        self.assertEqual(dead["attempt"], _MAX_JOB_RETRIES + 1)
        self.assertIn("last_failed_at", dead)

    async def test_invalid_job_json_goes_straight_to_dead_letter_queue(self):
        worker = FinalizeWorker()
        redis = FakeRedis()
        raw = "{bad-json"
        redis.lists[_PROCESSING_QUEUE_KEY] = [raw]

        await worker._process_claimed_job(redis, raw)

        self.assertEqual(redis.lists[_PROCESSING_QUEUE_KEY], [])
        self.assertEqual(redis.lists[_QUEUE_KEY], [])
        self.assertEqual(redis.lists[_DLQ_KEY], [raw])


if __name__ == "__main__":
    unittest.main(verbosity=2)
