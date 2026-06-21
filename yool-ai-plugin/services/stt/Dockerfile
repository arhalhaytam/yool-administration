# ──────────────────────────────────────────────────────────────────────────────
#  STT Service — Multi-layer Dockerfile
#
#  Layer strategy (ordered cheapest→heaviest for optimal cache reuse):
#    1. System deps        (~20 MB)  — changes almost never
#    2. Web/DB deps        (~80 MB)  — changes occasionally
#    3. torch CPU-only     (~270 MB) — changes rarely (CUDA build is 2.8 GB!)
#    4. Whisper+pyannote   (~600 MB) — changes rarely
#    5. App source         (~100 KB) — changes frequently
# ──────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim

# ── Python env ────────────────────────────────────────────────────────────────
# Prevents .pyc files from being written to disk
ENV PYTHONDONTWRITEBYTECODE=1 \
    # Force stdout/stderr to be unbuffered (critical for Docker logs)
    PYTHONUNBUFFERED=1 \
    # Pip: no version check, no cache, no user install warnings
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # HuggingFace: store models in /app/.cache (owned by appuser, on volume)
    HF_HOME=/app/.cache/huggingface \
    TORCH_HOME=/app/.cache/torch

WORKDIR /app

# ── System packages ───────────────────────────────────────────────────────────
# curl:         health check
# libsndfile1:  soundfile library (audio I/O)
# gosu:         privilege-drop in entrypoint (safer than su)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        libsndfile1 \
        gosu \
    && rm -rf /var/lib/apt/lists/*

# ── Layer 1: Web framework + DB dependencies (changes occasionally) ───────────
COPY services/stt/requirements-base.txt .
RUN pip install --no-cache-dir -r requirements-base.txt

# ── Layer 2: PyTorch CPU-only (~270 MB — NOT the 2.8 GB CUDA build) ──────────
# Installing torch in its own layer means re-builds triggered by app code
# changes never re-download 270 MB of wheels.
COPY services/stt/requirements-ai.txt .
RUN pip install --no-cache-dir -r requirements-ai.txt

# ── Layer 3: Whisper + pyannote (depend on torch above) ──────────────────────
# pyannote declares dependency on PyPI "lightning", which is quarantined (no files).
# Install declared deps + pytorch-lightning, then pyannote with --no-deps.
COPY services/stt/requirements-models.txt .
RUN pip install --no-cache-dir -r requirements-models.txt \
    && pip install --no-cache-dir --no-deps "pyannote.audio==3.3.2"

# ── App source (changes most often — last so it doesn't bust cache above) ─────
COPY shared/ ./shared/
COPY services/stt/ .

# ── Runtime user setup ───────────────────────────────────────────────────────
# Create appuser for the app to run as after entrypoint privilege drop.
# We do NOT switch to appuser here — the entrypoint runs as root, fixes the
# model_cache volume ownership, then exec's gosu to drop to appuser.
RUN useradd -m -u 1000 appuser \
    && mkdir -p /app/.cache/huggingface /app/.cache/torch \
    && chown -R appuser:appuser /app \
    && chmod +x /app/entrypoint.sh
# USER stays root intentionally — entrypoint drops to appuser via gosu

# ── Port & entrypoint ─────────────────────────────────────────────────────────
EXPOSE 8003

# Health check (also declared in docker-compose, kept here for standalone use)
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD curl -sf http://localhost:8003/health || exit 1

# 1 worker only — AI models are loaded into memory once and shared via in-process
# state. Multiple workers would load separate model copies (4+ GB each).
ENTRYPOINT ["/app/entrypoint.sh"]
