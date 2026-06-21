"""Minimal STT substitute for CI — nginx reaches /health on port 8003 only."""

from fastapi import FastAPI

app = FastAPI(title="STT CI stub", version="0")

@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "service": "stt", "models_loaded": True}
