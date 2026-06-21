"""
Focused tests for STT stream stop/fallback resolution logic.

Run:
    python test_stt_stream_stop_logic.py
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path


# Minimal env expected by STT settings import path.
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
    from routers.stream import _resolve_stop_from_db_status  # noqa: E402
    from shared.models import SessionStatus  # noqa: E402
except Exception as exc:  # pragma: no cover - environment-dependent
    _IMPORT_ERROR = exc
    _resolve_stop_from_db_status = None  # type: ignore[assignment]
    SessionStatus = None  # type: ignore[assignment]


@unittest.skipIf(_IMPORT_ERROR is not None, f"STT runtime dependencies unavailable: {_IMPORT_ERROR}")
class StreamStopFallbackTests(unittest.TestCase):
    def test_processing_status_requests_stop_and_ends_listener(self):
        stop_requested, should_end = _resolve_stop_from_db_status(SessionStatus.PROCESSING)
        self.assertTrue(stop_requested)
        self.assertTrue(should_end)

    def test_done_status_ends_without_requesting_stop(self):
        stop_requested, should_end = _resolve_stop_from_db_status(SessionStatus.DONE)
        self.assertFalse(stop_requested)
        self.assertTrue(should_end)

    def test_failed_status_ends_without_requesting_stop(self):
        stop_requested, should_end = _resolve_stop_from_db_status(SessionStatus.FAILED)
        self.assertFalse(stop_requested)
        self.assertTrue(should_end)

    def test_live_status_neither_stops_nor_ends(self):
        stop_requested, should_end = _resolve_stop_from_db_status(SessionStatus.LIVE)
        self.assertFalse(stop_requested)
        self.assertFalse(should_end)

    def test_none_status_neither_stops_nor_ends(self):
        stop_requested, should_end = _resolve_stop_from_db_status(None)
        self.assertFalse(stop_requested)
        self.assertFalse(should_end)


if __name__ == "__main__":
    unittest.main(verbosity=2)
