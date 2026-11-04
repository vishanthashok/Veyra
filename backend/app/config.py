import os
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET = "dev-only-change-me"  # noqa: S105  refused in production
LOCAL_DATABASE_URL = "postgresql+psycopg://veyra:veyra@localhost:5432/veyra"


def _default_database_url() -> str:
    """VEYRA_DATABASE_URL wins. Otherwise use the DATABASE_URL a platform add-on sets (Heroku)."""
    return os.environ.get("DATABASE_URL") or LOCAL_DATABASE_URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VEYRA_", env_file=".env", extra="ignore")

    env: Literal["development", "test", "production"] = "development"
    database_url: str = Field(default_factory=_default_database_url, validate_default=True)
    secret_key: str = DEFAULT_SECRET
    max_upload_bytes: int = 10 * 1024 * 1024
    cors_origins: list[str] = ["http://localhost:3000"]
    session_max_age_seconds: int = 8 * 3600
    cookie_secure: bool = False
    log_level: str = "INFO"

    @field_validator("database_url")
    @classmethod
    def _use_psycopg_driver(cls, v: str) -> str:
        """Platforms hand out postgres:// URLs. SQLAlchemy needs the psycopg 3 driver named."""
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix) :]
        return v

    def validate_for_runtime(self) -> None:
        """Refuse unsafe production configuration at startup (F-11)."""
        if self.env == "production":
            problems = []
            if self.secret_key == DEFAULT_SECRET or len(self.secret_key) < 32:
                problems.append("VEYRA_SECRET_KEY must be set to a random value of at least 32 characters")
            if not self.cookie_secure:
                problems.append("VEYRA_COOKIE_SECURE must be true in production")
            if problems:
                raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))


settings = Settings()
