"""Session service — admin-managed courses, live sessions, transcripts, topic outlines."""

import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import settings
from core.logging import configure_logging
from routers.courses import router as courses_router
from routers.sessions import router as sessions_router

configure_logging(settings.LOG_LEVEL)
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("session_service.startup", env=settings.ENVIRONMENT)
    yield
    log.info("session_service.shutdown")


app = FastAPI(
    title="Yool AI — Session Service",
    version="1.0.0",
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url=None,
    lifespan=lifespan,
    redirect_slashes=False,   # prevents POST /sessions/ → 307 → GET /sessions → 405
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    tb = traceback.format_exc()
    log.error(
        "unhandled_exception",
        path=request.url.path,
        exc_type=type(exc).__name__,
        error=str(exc),
        traceback=tb,
        request_id=getattr(request.state, "request_id", None),
    )
    # Expose the actual error outside production so tests can surface root causes
    if settings.ENVIRONMENT != "production":
        return JSONResponse(
            status_code=500,
            content={"detail": f"{type(exc).__name__}: {exc}"},
        )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


from routers.chapters import router as chapters_router
from routers.hierarchy import router as hierarchy_router

app.include_router(sessions_router, prefix="/api/sessions", tags=["sessions"])
app.include_router(courses_router,  prefix="/api/courses",  tags=["courses"])
app.include_router(chapters_router, prefix="/api/chapters", tags=["chapters"])
app.include_router(hierarchy_router, prefix="/api/hierarchy", tags=["hierarchy"])


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "service": "session"}
