"""Auth service configuration via environment variables."""

from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Misconfigured dev URLs that point at nginx (API only), not the Next.js app.
_DEV_APP_URL = "http://localhost:3000"
_BAD_PUBLIC_APP_URLS = frozenset({
    "https://localhost",
    "http://localhost",
    "https://127.0.0.1",
    "http://127.0.0.1",
})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENVIRONMENT: str = "production"
    LOG_LEVEL: str = "INFO"

    # Database
    DATABASE_URL: str

    # Redis
    REDIS_URL: str

    # JWT RS256
    JWT_PRIVATE_KEY_PATH: str = "/app/secrets/jwt_private.pem"
    JWT_PUBLIC_KEY_PATH: str  = "/app/secrets/jwt_public.pem"
    JWT_ALGORITHM: str        = "RS256"
    JWT_ACCESS_EXPIRE_MINUTES: int = 15
    JWT_REFRESH_EXPIRE_DAYS: int   = 7

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    # Invite links
    TEACHER_INVITE_EXPIRE_HOURS: int = 48  # single-use onboarding links for teachers/admins

    # Session cap — maximum concurrent refresh-token sessions per user (FIFO eviction)
    MAX_SESSIONS_PER_USER: int = 10

    # Scheduled housekeeping — how often the token cleanup loop runs (hours)
    TOKEN_CLEANUP_INTERVAL_HOURS: int = 24

    # Frontend URL — used in emails (reset, verify). In local dev this is usually Next.js (:3000).
    FRONTEND_URL: str = "http://localhost:3000"
    # Optional override for onboarding invite links (defaults to FRONTEND_URL).
    INVITE_BASE_URL: str = ""

    # Bootstrap — seeds the FIRST super_admin account at startup if none exist.
    # Set these once in .env, deploy, then you can leave them or remove them.
    # The account is only created when NO super_admin exists in the DB.
    SUPER_ADMIN_BOOTSTRAP_EMAIL: str    = ""
    SUPER_ADMIN_BOOTSTRAP_PASSWORD: str = ""

    # Rate limits — configurable so test environments can run higher values.
    LOGIN_RATE_LIMIT:        int = 5   # FAILED login attempts per IP per 15 min
    FORGOT_PW_RATE_LIMIT:    int = 10  # per IP per hour
    INVITE_TOKEN_RATE_LIMIT: int = 50  # per IP per hour (preview + accept combined)

    # Password reset tokens
    PASSWORD_RESET_EXPIRE_HOURS: int = 1      # Short window — sensitive action

    # Email verification tokens
    EMAIL_VERIFY_EXPIRE_HOURS: int = 24

    # SMTP — set all four to enable email sending
    # If SMTP_HOST is empty, the service falls back to logging the link (dev mode)
    SMTP_HOST: str     = ""
    SMTP_PORT: int     = 587
    SMTP_USER: str     = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str     = "noreply@yool.ai"
    SMTP_TLS: bool     = True                 # STARTTLS

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.SMTP_USER and self.SMTP_PASSWORD)

    @staticmethod
    def normalize_public_app_url(url: str) -> str:
        """Ensure links in emails target the Next.js app, not nginx-only https://localhost."""
        cleaned = url.strip().rstrip("/")
        if cleaned in _BAD_PUBLIC_APP_URLS:
            return _DEV_APP_URL
        return cleaned

    @model_validator(mode="after")
    def normalize_frontend_urls(self) -> "Settings":
        if self.ENVIRONMENT == "development":
            self.FRONTEND_URL = self.normalize_public_app_url(self.FRONTEND_URL)
            if self.INVITE_BASE_URL:
                self.INVITE_BASE_URL = self.normalize_public_app_url(self.INVITE_BASE_URL)
        return self

    @property
    def invite_base_url(self) -> str:
        """Base URL for teacher/admin onboarding links (no trailing slash)."""
        base = (self.INVITE_BASE_URL or self.FRONTEND_URL).strip().rstrip("/")
        return self.normalize_public_app_url(base)

    @property
    def jwt_private_key(self) -> str:
        return Path(self.JWT_PRIVATE_KEY_PATH).read_text()

    @property
    def jwt_public_key(self) -> str:
        return Path(self.JWT_PUBLIC_KEY_PATH).read_text()


settings = Settings()
