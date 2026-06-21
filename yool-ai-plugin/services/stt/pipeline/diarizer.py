"""Speaker diarization using pyannote-audio.

For each audio chunk, identifies who is speaking (TEACHER vs STUDENT).
The teacher is assumed to be the speaker with the most total speech time.
"""

import io
from dataclasses import dataclass

import numpy as np
import soundfile as sf
import torch

from pipeline.models_loader import get_models

SAMPLE_RATE = 16_000


@dataclass
class DiarizedSegment:
    speaker_label: str   # raw: SPEAKER_00, SPEAKER_01, ...
    start_s: float
    end_s: float


def diarize(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> list[DiarizedSegment]:
    """Run pyannote diarization on a numpy audio array.
    
    Returns list of DiarizedSegment sorted by start time.
    """
    models = get_models()
    if models is None:
        raise RuntimeError("Models not loaded")

    # pyannote expects a dict with 'waveform' (torch tensor CHW) and 'sample_rate'
    waveform = torch.from_numpy(audio).float().unsqueeze(0)  # (1, samples)
    input_dict = {"waveform": waveform, "sample_rate": sample_rate}

    diarization = models.diarizer(input_dict)

    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append(DiarizedSegment(
            speaker_label=speaker,
            start_s=turn.start,
            end_s=turn.end,
        ))

    return sorted(segments, key=lambda s: s.start_s)


def identify_teacher(
    sessions_speaker_time: dict[str, float]
) -> str | None:
    """The teacher is the speaker with the most cumulative speech time."""
    if not sessions_speaker_time:
        return None
    return max(sessions_speaker_time, key=sessions_speaker_time.get)


def update_speaker_times(
    speaker_times: dict[str, float],
    segments: list[DiarizedSegment],
) -> dict[str, float]:
    """Accumulate speech duration per speaker across chunks."""
    for seg in segments:
        duration = seg.end_s - seg.start_s
        speaker_times[seg.speaker_label] = speaker_times.get(seg.speaker_label, 0.0) + duration
    return speaker_times
