"""Session service configuration via environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENVIRONMENT: str = "production"
    LOG_LEVEL:   str = "INFO"

    # Database
    DATABASE_URL: str

    # Redis
    REDIS_URL: str

    # JWT RS256 — session service only verifies (no private key needed)
    JWT_PUBLIC_KEY_PATH: str = "/app/secrets/jwt_public.pem"
    JWT_ALGORITHM: str       = "RS256"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    # GDPR Art. 5 (storage limitation) — default retention window for sessions
    # Admin can override per-request; this is the safe default.
    RETENTION_DAYS: int = 365

    # Rate limits — configurable so they can be relaxed in dev/staging without
    # requiring code changes (set via environment variable).
    SESSION_CREATE_RATE_LIMIT: int = 100   # per IP per hour
    COURSE_CREATE_RATE_LIMIT:  int = 20    # per IP per hour
    PURGE_RATE_LIMIT:          int = 20    # per IP per hour (destructive bulk-delete)

    @property
    def jwt_public_key(self) -> str:
        return Path(self.JWT_PUBLIC_KEY_PATH).read_text()


settings = Settings()
