"""STT service — WebSocket audio pipeline, transcription, and summarization."""

import asyncio
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import settings
from core.redis import get_redis
from pipeline.models_loader import load_all_models, get_models
from pipeline.finalize_worker import get_finalize_worker
from routers.stream import router as stream_router

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("stt_service.startup", whisper_model=settings.WHISPER_MODEL)

    async def _load_models_task() -> None:
        while True:
            try:
                await load_all_models()
                break
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.error("stt_service.models_load_failed", error=str(e), hint="Retrying in 5 seconds...")
                await asyncio.sleep(5)

    load_task = asyncio.create_task(_load_models_task())

    # Start the background finalize worker (Fix 4)
    worker = get_finalize_worker()
    await worker.start()

    try:
        yield
    finally:
        load_task.cancel()
        try:
            await load_task
        except asyncio.CancelledError:
            pass
        await worker.stop()
        log.info("stt_service.shutdown")


app = FastAPI(
    title="Yool AI — STT Service",
    version="1.0.0",
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    rid = str(uuid.uuid4())
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("unhandled_exception", path=request.url.path, error=str(exc))
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(stream_router, prefix="/api/stt", tags=["stt"])


@app.get("/health", include_in_schema=False)
async def health():
    models = get_models()
    worker = get_finalize_worker()
    worker_running = bool(getattr(worker, "_task", None) and not worker._task.done())
    queue_stats: dict[str, int] | None = None
    queue_error: str | None = None
    try:
        redis = get_redis()
        queued, processing, dlq = await asyncio.gather(
            redis.llen("stt:jobs"),
            redis.llen("stt:jobs:processing"),
            redis.llen("stt:jobs:dlq"),
        )
        queue_stats = {
            "queued": int(queued),
            "processing": int(processing),
            "dead_letter": int(dlq),
        }
    except Exception as e:
        queue_error = str(e)
        log.error("stt_health.queue_stats_failed", error=queue_error)
    return {
        "status": "ok",
        "service": "stt",
        "models_loaded": models is not None,
        "finalize_worker_running": worker_running,
        "queues": queue_stats,
        "queue_error": queue_error,
    }
