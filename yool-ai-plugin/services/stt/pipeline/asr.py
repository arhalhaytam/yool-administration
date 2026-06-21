"""ASR using faster-whisper — transcription + language detection.

Input:  numpy float32 PCM at 16kHz mono
Output: TranscriptionResult with text, language, and word-level segments
"""

from dataclasses import dataclass, field

import numpy as np

from pipeline.models_loader import get_models


@dataclass
class TranscriptionResult:
    text: str
    language: str
    language_probability: float
    words: list[dict] = field(default_factory=list)


def transcribe(audio: np.ndarray, initial_prompt: str | None = None) -> TranscriptionResult:
    """Transcribe audio chunk. Detects language automatically."""
    models = get_models()
    if models is None:
        raise RuntimeError("Models not loaded")

    # NOTE: transcribe() returns a lazy generator — must call list() to fully consume it
    # before any other model operation, or segments will be silently empty.
    segments_gen, info = models.whisper.transcribe(
        audio,
        beam_size=5,
        language=None,          # auto-detect
        vad_filter=False,       # we already ran silero-vad upstream
        word_timestamps=True,
        temperature=0.0,        # greedy decoding — more deterministic
        condition_on_previous_text=False, # prevent looping from context
        initial_prompt=initial_prompt,
    )
    segments = list(segments_gen)  # force full evaluation now

    full_text = ""
    words = []
    for seg in segments:
        full_text += seg.text
        if seg.words:
            for w in seg.words:
                words.append({
                    "word": w.word,
                    "start": w.start,
                    "end": w.end,
                    "probability": w.probability,
                })

    return TranscriptionResult(
        text=full_text.strip(),
        language=info.language,
        language_probability=info.language_probability,
        words=words,
    )


DARIJA_INDICATORS = {"ar"}  # Whisper codes darija as Arabic

def is_darija_context(language: str) -> bool:
    """Returns True if the detected language could be Darija (coded as Arabic by Whisper)."""
    return language in DARIJA_INDICATORS
