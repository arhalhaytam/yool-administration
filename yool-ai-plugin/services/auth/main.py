"""Auth service — JWT RS256, RBAC, session management."""

import asyncio
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import settings
from core.logging import configure_logging
from core.tasks import run_cleanup_loop
from routers.admin import router as admin_router
from routers.auth import router as auth_router

configure_logging(settings.LOG_LEVEL)
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(
        "auth_service.startup",
        env=settings.ENVIRONMENT,
        frontend_url=settings.FRONTEND_URL,
        invite_base_url=settings.invite_base_url,
    )
    await _bootstrap_super_admin()

    cleanup_task = asyncio.create_task(
        run_cleanup_loop(settings.TOKEN_CLEANUP_INTERVAL_HOURS)
    )
    log.info(
        "scheduler.token_cleanup.started",
        interval_hours=settings.TOKEN_CLEANUP_INTERVAL_HOURS,
    )

    yield

    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    log.info("auth_service.shutdown")


async def _bootstrap_super_admin() -> None:
    """
    Seeds the first SUPER_ADMIN account from environment variables if none exists.
    Runs once at startup — safe to call on every restart (idempotent).
    """
    if not settings.SUPER_ADMIN_BOOTSTRAP_EMAIL or not settings.SUPER_ADMIN_BOOTSTRAP_PASSWORD:
        log.warning(
            "bootstrap.super_admin.skipped",
            reason="SUPER_ADMIN_BOOTSTRAP_EMAIL or SUPER_ADMIN_BOOTSTRAP_PASSWORD not set",
        )
        return

    from sqlalchemy import select
    from core.security import hash_password
    from shared.database import async_session_maker
    from shared.models import User, UserRole
    import uuid

    async with async_session_maker() as db:
        result = await db.execute(
            select(User).where(User.role == UserRole.SUPER_ADMIN).limit(1)
        )
        if result.scalar_one_or_none():
            log.info("bootstrap.super_admin.skipped", reason="super_admin already exists")
            return

        super_admin = User(
            id=uuid.uuid4(),
            email=settings.SUPER_ADMIN_BOOTSTRAP_EMAIL,
            password_hash=hash_password(settings.SUPER_ADMIN_BOOTSTRAP_PASSWORD),
            full_name="Super Admin",
            role=UserRole.SUPER_ADMIN,
            is_active=True,
            is_verified=True,
        )
        db.add(super_admin)
        await db.commit()
        log.info(
            "bootstrap.super_admin.created",
            email=settings.SUPER_ADMIN_BOOTSTRAP_EMAIL,
            user_id=str(super_admin.id),
        )


app = FastAPI(
    title="Yool AI — Auth Service",
    version="1.0.0",
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url=None,
    lifespan=lifespan,
    redirect_slashes=False,   # prevents POST /login/ → 307 → GET /login → 405
)

# CORS — only allow the frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# Request ID middleware for distributed tracing
@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# Global exception handler — never leak stack traces
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error(
        "unhandled_exception",
        path=request.url.path,
        error=str(exc),
        request_id=getattr(request.state, "request_id", None),
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


app.include_router(auth_router,  prefix="/api/auth",       tags=["auth"])
app.include_router(admin_router, prefix="/api/auth/admin", tags=["admin"])


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "service": "auth"}
