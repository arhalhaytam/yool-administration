"""Core audio processing pipeline — VAD, ASR, diarization, and final topic outline.

Enterprise pivot: live partial summaries removed entirely. The pipeline now
only emits per-chunk transcripts during the live session and a single,
self-contained topic outline when the teacher presses Stop.

Improvements (v2):
  - Fix 1: Teacher identification via cumulative speech-time over a 5-min
    warmup window rather than a blind "first-10s = teacher" anchor.
  - Fix 2: 1.5-second tail overlap between chunks prevents hard word splits
    at chunk boundaries. A suffix/prefix dedup pass removes the duplicated
    text before it enters the transcript.
"""

import asyncio
import time
import uuid
from collections import defaultdict

import numpy as np
import redis.asyncio as aioredis
import structlog
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from pipeline.asr import TranscriptionResult, transcribe
from pipeline.diarizer import DiarizedSegment, diarize, identify_teacher, update_speaker_times
from pipeline.embed_text import build_searchable_text
from pipeline.summarizer import generate_embedding, generate_topic_outline
from pipeline.vad import detect_speech_segments, extract_speech_audio, find_slice_point

log = structlog.get_logger()

SAMPLE_RATE = 16_000
CHUNK_SAMPLES = SAMPLE_RATE * 10  # 10 seconds of audio per chunk

# Fix 1: How long to accumulate speaker times before locking in the teacher.
# Reduced to 15 seconds for testing/demo purposes.
WARMUP_SECONDS = 15  # 15 seconds

# Fix 2: Tail samples copied into the next chunk's buffer to avoid word splits.
OVERLAP_SAMPLES = int(SAMPLE_RATE * 1.5)  # 1.5 seconds


class FinalizeRejected(Exception):
    """Session row is not eligible for persistence (e.g. cancelled mid-stream)."""


# ---------------------------------------------------------------------------
# Fix 2 helper — suffix/prefix deduplication
# ---------------------------------------------------------------------------

def _dedup_overlap(prev_text: str, new_text: str, max_check: int = 60) -> str:
    """Strip duplicated boundary text caused by the chunk overlap.

    Finds the longest suffix of *prev_text* (up to *max_check* chars) that
    appears as a prefix of *new_text* and removes it from *new_text*.
    """
    if not prev_text or not new_text:
        return new_text

    # Normalise whitespace for comparison
    prev_stripped = prev_text.strip()
    new_stripped = new_text.lstrip()

    check_len = min(max_check, len(prev_stripped), len(new_stripped))
    best = 0
    for length in range(1, check_len + 1):
        suffix = prev_stripped[-length:].lower()
        prefix = new_stripped[:length].lower()
        if suffix == prefix:
            best = length

    if best == 0:
        return new_text

    # Remove the overlapping prefix from new_text (preserve leading whitespace shape)
    leading_ws = len(new_text) - len(new_text.lstrip())
    return new_text[:leading_ws] + new_text.lstrip()[best:]


class SessionProcessor:
    """Stateful processor for a single live session.

    Holds the audio buffer, transcript accumulation, and speaker-time tracking
    for one WebSocket connection. The teacher manually presses Stop, which
    triggers `finalize()` to produce the topic outline and persist it.
    """

    def __init__(self, session_id: uuid.UUID, redis: aioredis.Redis):
        self.session_id = session_id
        self.redis = redis

        # Audio state
        self.buffer: list[np.ndarray] = []
        self.buffer_samples: int = 0
        self.session_start_ms: int = int(time.time() * 1000)
        self.elapsed_samples: int = 0
        self.full_audio: list[np.ndarray] = []
        self._next_slice_index: int | None = None

        # Transcript prompt primings — cleared after first chunk to prevent hallucination
        self.initial_prompt: str | None = None
        self._initial_prompt_used: bool = False

        # Sliding window for diarization (stores recent packed speech)
        self.recent_packed_speech: list[np.ndarray] = []

        # Transcript accumulation
        self.transcript_segments: list[dict] = []
        self.full_transcript_text: str = ""
        self.dominant_language: str = "fr"
        self.language_counts: dict[str, int] = defaultdict(int)

        # Fix 1 — cumulative speaker-time diarization
        self.speaker_times: dict[str, float] = {}
        self.teacher_label: str | None = None          # None until warmup is done
        self._pending_relabel: list[dict] = []         # segments awaiting teacher lock-in

        # Fix 2 — overlap tail buffer
        self._overlap_tail: np.ndarray = np.array([], dtype=np.float32)

    # ------------------------------------------------------------------
    # Audio ingestion
    # ------------------------------------------------------------------

    def add_audio_chunk(self, pcm_bytes: bytes) -> None:
        """Accept raw PCM bytes (int16, 16kHz mono) and buffer them.

        Raises ValueError if buffer exceeds 50MB (protection against runaway streams).
        """
        if not pcm_bytes:
            return
        # int16 samples are pairs of bytes — trim a stray byte so frombuffer never misaligns.
        if len(pcm_bytes) % 2 != 0:
            pcm_bytes = pcm_bytes[:-1]
            if not pcm_bytes:
                return

        MAX_BUFFER_BYTES = 50 * 1024 * 1024  # 50 MB ≈ ~25 min of audio
        if self.buffer_samples * 2 > MAX_BUFFER_BYTES:
            raise ValueError("Audio buffer exceeded 50MB limit — possible runaway stream")
        audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self.buffer.append(audio)
        self.buffer_samples += len(audio)

    def has_full_chunk(self) -> bool:
        if self.buffer_samples <= 0:
            return False
        combined = np.concatenate(self.buffer)
        slice_idx = find_slice_point(combined)
        if slice_idx is not None:
            self._next_slice_index = slice_idx
            return True
        return False

    # ------------------------------------------------------------------
    # Chunk processing
    # ------------------------------------------------------------------

    async def process_next_chunk(self) -> dict | None:
        """Process one semantically-sliced chunk. Returns transcript segment dict or None."""
        if self._next_slice_index is None:
            if not self.has_full_chunk():
                return None

        slice_idx = self._next_slice_index
        self._next_slice_index = None

        # Fix 2: prepend overlap tail from previous chunk
        parts = []
        if len(self._overlap_tail) > 0:
            parts.append(self._overlap_tail)
        parts.extend(self.buffer)
        combined = np.concatenate(parts)

        # Adjust slice_idx to account for the prepended tail
        adjusted_slice = slice_idx + len(self._overlap_tail)

        chunk = combined[:adjusted_slice]
        remainder = combined[slice_idx:]  # advance without the overlap padding
        self.buffer = [remainder] if len(remainder) > 0 else []
        self.buffer_samples = len(remainder)

        # Store last 1.5 s of this chunk as the next overlap tail
        self._overlap_tail = chunk[-OVERLAP_SAMPLES:].copy() if len(chunk) >= OVERLAP_SAMPLES else chunk.copy()

        # Accumulate full audio for global finalization diarization
        self.full_audio.append(chunk)

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, self._process_chunk_sync, chunk)
        return result

    async def flush_tail(self) -> dict | None:
        """Process any remaining buffered audio shorter than one full chunk (clean stop).

        Without this, the last few seconds of a lecture would stay buffered and never
        reach transcription when the teacher presses Stop immediately after speaking.
        """
        if self.buffer_samples <= 0:
            return None
        combined = np.concatenate(self.buffer)
        self.buffer = []
        self.buffer_samples = 0
        if len(combined) == 0:
            return None

        # No overlap needed for the tail flush — it's the last chunk
        self._overlap_tail = np.array([], dtype=np.float32)

        # Accumulate final tail chunk for global finalization diarization
        self.full_audio.append(combined)

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._process_chunk_sync, combined)

    # ------------------------------------------------------------------
    # Fix 1 — teacher identification helpers
    # ------------------------------------------------------------------

    def _relabel_pending_segments(self) -> None:
        """Re-label all pending 'unknown' segments now that teacher_label is known."""
        if self.teacher_label is None:
            return
        for seg in self._pending_relabel:
            if seg["speaker_label"] == self.teacher_label:
                seg["speaker_role"] = "teacher"
            else:
                seg["speaker_role"] = "participant"
        self._pending_relabel.clear()
        log.info(
            "diarization.teacher_locked",
            session_id=str(self.session_id),
            teacher_label=self.teacher_label,
        )

    # ------------------------------------------------------------------
    # Hallucination detection
    # ------------------------------------------------------------------

    def _is_hallucination(self, text: str) -> bool:
        """Detect Whisper hallucinations — repeated filler phrases on silence.

        Two checks:
        1. N-gram repetition: catches phrases looping anywhere in the string.
        2. The text is suspiciously short and matches only the initial_prompt words.
        """
        if not text:
            return False

        words = text.lower().replace(",", "").replace(".", "").replace("!", "").replace("?", "").split()
        
        # Check 1: N-gram repetition (e.g. phrase repeated 4+ times consecutively)
        if len(words) >= 12:
            # Check phrase lengths from 3 to 15 words
            for n in range(3, min(16, len(words) // 4 + 1)):
                for i in range(len(words) - 4 * n + 1):
                    ngram = words[i:i+n]
                    is_loop = True
                    for k in range(1, 4):
                        if words[i + k*n : i + (k+1)*n] != ngram:
                            is_loop = False
                            break
                    if is_loop:
                        return True

        # Check 2: the entire text is just known metadata words
        # (course name / level echoed with no real content)
        if len(words) <= 6:
            text_lower = text.lower()
            filler_tokens = {"mathématiques", "physiques", "sciences", "bac", "2bac",
                             "1bac", "terminale", "tronc", "commun", "math", "arabic",
                             "français", "anglais"}
            real_words = [w.strip(".,;:").lower() for w in words
                          if w.strip(".,;:").lower() not in filler_tokens]
            if len(real_words) == 0:
                return True

        return False

    # ------------------------------------------------------------------
    # Core synchronous processing (runs in thread pool)
    # ------------------------------------------------------------------

    def _process_chunk_sync(self, chunk: np.ndarray) -> dict | None:
        """Synchronous processing — runs in thread pool."""
        # MUST increment elapsed samples immediately so silence chunks don't cause time drift!
        chunk_start_samples = self.elapsed_samples
        # Subtract the overlap tail length from elapsed samples to keep timestamps accurate
        actual_chunk_start = max(0, self.elapsed_samples - len(self._overlap_tail))
        chunk_start_samples = actual_chunk_start
        self.elapsed_samples += len(chunk) - len(self._overlap_tail)

        # 1. Transcribe (use overlap so Whisper has context for word boundaries)
        result: TranscriptionResult = transcribe(chunk, initial_prompt=self.initial_prompt)

        # Clear initial_prompt after first use — prevents Whisper hallucinating it on silence
        if not self._initial_prompt_used:
            self._initial_prompt_used = True
            self.initial_prompt = None

        if not result.text:
            return None

        # Hallucination guard: drop segment if it's just the priming words repeated
        stripped = result.text.strip()
        if self._is_hallucination(stripped):
            log.warning("asr.hallucination_dropped", text=stripped[:80])
            return None

        # Fix 2: strip duplicated prefix that came from the overlap
        deduped_text = _dedup_overlap(self.full_transcript_text, result.text)
        if not deduped_text.strip():
            return None

        self.language_counts[result.language] += 1
        self.dominant_language = max(self.language_counts, key=self.language_counts.get)

        # 2. Extract speech-only audio for Pyannote
        speech_segments = detect_speech_segments(chunk)
        if not speech_segments:
            speech_audio = np.array([], dtype=np.float32)
        else:
            speech_audio = extract_speech_audio(chunk, speech_segments)

        chunk_speaker_label = "SPEAKER_00"
        speaker_role = "unknown"

        # Fix 1 — cumulative speaker-time approach
        if len(speech_audio) > 0:
            # Maintain a sliding window of packed speech (up to ~30s of pure speech)
            self.recent_packed_speech.append(speech_audio)
            # 3 chunks of 10s speech = 30s max (reduced from 60s to prevent CPU lag)
            if len(self.recent_packed_speech) > 3:
                self.recent_packed_speech.pop(0)
            
            context_speech = np.concatenate(self.recent_packed_speech)
            diar_segments = diarize(context_speech)
            
            if diar_segments:
                # Find dominant speaker in the CURRENT chunk's portion of the context
                from collections import defaultdict
                current_start_s = (len(context_speech) - len(speech_audio)) / SAMPLE_RATE
                current_end_s = len(context_speech) / SAMPLE_RATE
                
                speaker_times_in_chunk = defaultdict(float)
                for seg in diar_segments:
                    overlap_start = max(seg.start_s, current_start_s)
                    overlap_end = min(seg.end_s, current_end_s)
                    if overlap_start < overlap_end:
                        speaker_times_in_chunk[seg.speaker_label] += (overlap_end - overlap_start)
                
                if speaker_times_in_chunk:
                    chunk_speaker_label = max(speaker_times_in_chunk, key=speaker_times_in_chunk.get)
                    # Accumulate global times based on the local mapped label
                    self.speaker_times[chunk_speaker_label] = self.speaker_times.get(chunk_speaker_label, 0.0) + (len(speech_audio) / SAMPLE_RATE)
                else:
                    chunk_speaker_label = diar_segments[-1].speaker_label

            elapsed_s = self.elapsed_samples / SAMPLE_RATE

            if self.teacher_label is None:
                if elapsed_s >= WARMUP_SECONDS:
                    # Warmup done — lock in the teacher
                    self.teacher_label = identify_teacher(self.speaker_times)
                    self._relabel_pending_segments()

            if self.teacher_label is not None:
                speaker_role = "teacher" if chunk_speaker_label == self.teacher_label else "participant"
            else:
                # Still in warmup — tentatively assume teacher (will be fixed on lock-in)
                speaker_role = "pending"

        start_ms = int(chunk_start_samples / SAMPLE_RATE * 1000)
        end_ms = start_ms + int((len(chunk) - len(self._overlap_tail)) / SAMPLE_RATE * 1000)

        segment = {
            "id": str(uuid.uuid4()),
            "session_id": str(self.session_id),
            "speaker_role": speaker_role,
            "speaker_label": chunk_speaker_label,
            "text": deduped_text,
            "language": result.language,
            "segment_start_ms": start_ms,
            "segment_end_ms": end_ms,
        }

        self.transcript_segments.append(segment)
        self.full_transcript_text += f"\n{deduped_text}"

        # Track pending segments for retroactive re-labeling
        if speaker_role == "pending":
            self._pending_relabel.append(segment)

        # Feed the last ~200 characters of context into the next chunk's initial_prompt
        if self.full_transcript_text:
            self.initial_prompt = self.full_transcript_text[-200:]

        return segment

    # ------------------------------------------------------------------
    # Finalization — split into two steps for the background job queue
    # ------------------------------------------------------------------

    async def persist_transcripts(self, db_session) -> dict:
        """Step 1: Save all transcript segments to DB and return metadata for the LLM.

        This commits BEFORE the LLM is called so a 429 crash never loses transcripts.
        Returns a metadata dict needed by the background finalize worker.
        """
        from shared.models import (
            Course,
            Chapter,
            Session as DBSession,
            SessionStatus,
            SpeakerRole,
            Transcript,
        )
        import uuid as _uuid

        log.info("persist_transcripts.started", session_id=str(self.session_id))

        result = await db_session.execute(
            select(DBSession)
            .options(
                selectinload(DBSession.chapter).selectinload(Chapter.course).selectinload(Course.teacher),
                selectinload(DBSession.chapter).selectinload(Chapter.course).selectinload(Course.level),
                selectinload(DBSession.chapter).selectinload(Chapter.course).selectinload(Course.matiere),
            )
            .where(
                DBSession.id == self.session_id,
                DBSession.status.in_((SessionStatus.LIVE, SessionStatus.PROCESSING)),
            )
            .with_for_update()
        )
        sess = result.scalar_one_or_none()
        if sess is None:
            log.warning("persist_transcripts.rejected", session_id=str(self.session_id))
            raise FinalizeRejected(
                "Session was cancelled or is no longer eligible for finalization."
            )

        # Retroactively resolve any still-pending segments (session < 5 min)
        if self.teacher_label is None and self.speaker_times:
            self.teacher_label = identify_teacher(self.speaker_times)
            self._relabel_pending_segments()

        for seg in self.transcript_segments:
            final_role = seg.get("speaker_role", "unknown")
            final_label = seg.get("speaker_label", "SPEAKER_00")

            if final_role in ("student", "pending"):
                final_role = "unknown"

            role = (
                SpeakerRole.TEACHER if final_role == "teacher" else
                SpeakerRole.PARTICIPANT if final_role == "participant" else
                SpeakerRole.UNKNOWN
            )
            db_session.add(Transcript(
                id=_uuid.UUID(seg["id"]),
                session_id=self.session_id,
                speaker_role=role,
                speaker_label=final_label,
                text=seg["text"],
                language=seg["language"],
                segment_start_ms=seg["segment_start_ms"],
                segment_end_ms=seg["segment_end_ms"],
            ))

        # Extract metadata BEFORE committing (which expires `sess`)
        if sess and sess.chapter and sess.chapter.course:
            self.dominant_language = sess.chapter.course.official_language

        meta = {
            "session_id": str(sess.id),
            "session_title": sess.title or "",
            "recorded_at": (
                sess.started_at.isoformat() if sess.started_at
                else sess.created_at.isoformat()
            ),
            "level_name": (
                sess.chapter.course.level.name
                if sess and sess.chapter and sess.chapter.course and sess.chapter.course.level
                else ""
            ),
            "matiere_name": (
                sess.chapter.course.matiere.name
                if sess and sess.chapter and sess.chapter.course and sess.chapter.course.matiere
                else ""
            ),
            "chapter_title": sess.chapter.title if sess and sess.chapter else "",
            "teacher_name": (
                sess.chapter.course.teacher.full_name
                if sess and sess.chapter and sess.chapter.course and sess.chapter.course.teacher
                else ""
            ),
        }

        # Commit transcripts before handing off to LLM
        await db_session.commit()
        log.info("persist_transcripts.committed", session_id=str(self.session_id))

        return meta

    def build_finalize_payload(self) -> dict:
        """Return the data needed by the background worker to call the LLM."""
        return {
            "session_id": str(self.session_id),
            "transcript_text": self.full_transcript_text,
            "dominant_language": self.dominant_language,
        }

    async def finalize(self, db_session) -> dict:
        """Legacy single-step finalize — kept for the retry endpoint.

        New code paths should use persist_transcripts() + build_finalize_payload()
        and let FinalizeWorker handle the LLM call.
        """
        meta = await self.persist_transcripts(db_session)

        outline = await generate_topic_outline(
            self.full_transcript_text,
            self.dominant_language,
            context_metadata=meta,
        )

        outline["course_title"]  = f"{meta['matiere_name']} - {meta['level_name']}"
        outline["chapter_title"] = meta["chapter_title"]
        outline["teacher_name"]  = meta["teacher_name"]
        outline["session_title"] = meta["session_title"]
        outline["session_id"]    = meta["session_id"]
        outline["recorded_at"]   = meta["recorded_at"]

        searchable_text = build_searchable_text(outline)

        embedding = await generate_embedding(searchable_text) if searchable_text else None

        from shared.models import Summary
        import uuid as _uuid
        db_session.add(Summary(
            id=_uuid.uuid4(),
            session_id=self.session_id,
            content=outline,
            embedding=embedding,
        ))

        log.info("session.finalized", session_id=str(self.session_id))
        return outline
