"""Voice Activity Detection using silero-vad.

Segments incoming PCM audio into voiced chunks, dropping silence.
Input:  numpy array of float32 PCM samples at 16000 Hz mono
Output: list of (start_sample, end_sample) tuples for voiced segments
"""

import numpy as np
import torch
from pipeline.models_loader import get_models

SAMPLE_RATE = 16_000
MIN_SPEECH_DURATION_MS = 250   # ignore very short bursts
MAX_SILENCE_MS = 200           # merge segments if silence is shorter than this


def detect_speech_segments(
    audio: np.ndarray,
    sample_rate: int = SAMPLE_RATE,
) -> list[tuple[int, int]]:
    """Return list of (start, end) sample indices for voiced segments."""
    models = get_models()
    if models is None:
        raise RuntimeError("Models not loaded")

    get_speech_timestamps = models.get_speech_timestamps

    audio_tensor = torch.from_numpy(audio).float()

    segments = get_speech_timestamps(
        audio_tensor,
        models.vad_model,
        sampling_rate=sample_rate,
        min_speech_duration_ms=MIN_SPEECH_DURATION_MS,
        max_speech_duration_s=30,
        min_silence_duration_ms=MAX_SILENCE_MS,
        return_seconds=False,
    )

    return [(s["start"], s["end"]) for s in segments]


def has_speech(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bool:
    """Quick check — returns True if any speech detected in chunk."""
    return len(detect_speech_segments(audio, sample_rate)) > 0


def extract_speech_audio(
    audio: np.ndarray, segments: list[tuple[int, int]]
) -> np.ndarray:
    """Concatenate only the voiced portions of audio."""
    if not segments:
        return np.array([], dtype=np.float32)
    parts = [audio[start:end] for start, end in segments]
    return np.concatenate(parts)


def find_slice_point(
    audio: np.ndarray,
    min_samples: int = SAMPLE_RATE * 8,       # 8 seconds
    target_samples: int = SAMPLE_RATE * 10,   # 10 seconds
    max_samples: int = SAMPLE_RATE * 14,      # 14 seconds
    sample_rate: int = SAMPLE_RATE,
) -> int | None:
    """Finds a silence boundary in the audio to slice it semantically.

    Returns the sample index where the audio should be sliced, or None if no
    good silence boundary was found yet and we haven't hit the max limit.
    """
    if len(audio) < min_samples:
        return None

    # Detect speech segments using Silero VAD
    segments = detect_speech_segments(audio, sample_rate)
    if not segments:
        # Whole audio is silence! If we have enough, slice at target_samples
        if len(audio) >= target_samples:
            return target_samples
        return None

    # Check if there is silence at the start of the buffer (before the first speech segment)
    first_start = segments[0][0]
    if first_start >= min_samples:
        return min(first_start // 2 + min_samples // 2, max_samples)

    # Check all gaps between consecutive speech segments
    best_slice = None
    best_dist = float("inf")

    for i in range(len(segments) - 1):
        gap_start = segments[i][1]
        gap_end = segments[i + 1][0]

        # Slice at the midpoint of the gap
        slice_candidate = (gap_start + gap_end) // 2

        # Check if the candidate falls within our acceptable window
        if min_samples <= slice_candidate <= max_samples:
            dist = abs(slice_candidate - target_samples)
            if dist < best_dist:
                best_dist = dist
                best_slice = slice_candidate

    if best_slice is not None:
        return best_slice

    # If the last segment ends and we have silence at the end
    last_end = segments[-1][1]
    if last_end <= max_samples and len(audio) >= last_end + int(sample_rate * 0.5):
        slice_candidate = max(min_samples, last_end + int(sample_rate * 0.25))
        if slice_candidate <= len(audio):
            return slice_candidate

    # If buffer exceeds max_samples and we still found no silence gap, force a slice at target_samples
    if len(audio) >= max_samples:
        return target_samples

    return None
