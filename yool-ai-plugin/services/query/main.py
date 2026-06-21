"""Query service — summaries, transcripts, and semantic search."""

import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import settings
from routers.query import router as query_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    structlog.get_logger().info("query_service.startup")
    yield


app = FastAPI(
    title="Yool AI — Query Service",
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
    structlog.get_logger().error("unhandled_exception", path=request.url.path, error=str(exc))
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(query_router, prefix="/api/query", tags=["query"])


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "service": "query"}
