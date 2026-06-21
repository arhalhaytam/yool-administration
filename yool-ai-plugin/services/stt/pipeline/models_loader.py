"""Loads all AI models once at startup and provides global access."""

import asyncio
from dataclasses import dataclass
from typing import Any

import structlog
from faster_whisper import WhisperModel
from pyannote.audio import Pipeline as DiarizationPipeline

from core.config import settings

log = structlog.get_logger()

@dataclass
class Models:
    whisper: WhisperModel
    diarizer: DiarizationPipeline
    vad_model: Any           # silero-vad model
    get_speech_timestamps: Any  # callable from silero-vad utils


_models: Models | None = None


def get_models() -> Models | None:
    return _models


async def load_all_models() -> None:
    """Load all models in a thread pool executor (they're synchronous and CPU-bound)."""
    global _models
    loop = asyncio.get_running_loop()
    _models = await loop.run_in_executor(None, _load_sync)


def _load_sync() -> Models:
    import os
    import torch

    # Redirect torch hub cache into the persistent model_cache volume.
    # Must be set before any torch.hub call.
    os.environ["TORCH_HOME"] = settings.TORCH_HOME
    torch.hub.set_dir(settings.TORCH_HOME)
    log.info("loading.whisper", model=settings.WHISPER_MODEL, device=settings.WHISPER_DEVICE)
    whisper = WhisperModel(
        settings.WHISPER_MODEL,
        device=settings.WHISPER_DEVICE,
        compute_type=settings.WHISPER_COMPUTE_TYPE,
    )

    log.info("loading.pyannote")
    # HF_TOKEN is read automatically from the environment by huggingface_hub.
    # Do NOT pass it as a kwarg — the parameter name changed between versions
    # (use_auth_token → token) and causes TypeError on either old or new installs.
    diarizer = DiarizationPipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
    )

    log.info("loading.silero_vad")
    vad_model, vad_utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        force_reload=False,
        trust_repo=True,   # snakers4/silero-vad is the official repo
    )
    # vad_utils is a tuple: (get_speech_timestamps, save_audio, read_audio, VADIterator, collect_chunks)
    get_speech_timestamps = vad_utils[0]

    log.info("all_models.loaded")
    return Models(
        whisper=whisper,
        diarizer=diarizer,
        vad_model=vad_model,
        get_speech_timestamps=get_speech_timestamps,
    )
