"""STT service config."""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENVIRONMENT: str = "production"
    DATABASE_URL: str
    REDIS_URL: str
    OPENAI_API_KEY: str
    OPENAI_CHAT_MODEL: str = "gpt-4o-mini"
    OPENAI_EMBED_MODEL: str = "text-embedding-3-small"
    HF_TOKEN: str
    WHISPER_MODEL: str = "medium"
    WHISPER_DEVICE: str = "cpu"
    WHISPER_COMPUTE_TYPE: str = "int8"
    # Torch hub cache — must point inside the model_cache volume so silero-vad
    # is not re-downloaded on every container restart.
    TORCH_HOME: str = "/app/.cache/torch"
    JWT_PUBLIC_KEY_PATH: str = "/app/secrets/jwt_public.pem"
    JWT_ALGORITHM: str = "RS256"
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    @property
    def jwt_public_key(self) -> str:
        return Path(self.JWT_PUBLIC_KEY_PATH).read_text()


settings = Settings()
