from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET = "dev-only-change-me"  # noqa: S105  refused in production


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VEYRA_", env_file=".env", extra="ignore")

    env: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+psycopg://veyra:veyra@localhost:5432/veyra"
    secret_key: str = DEFAULT_SECRET
    max_upload_bytes: int = 10 * 1024 * 1024
    cors_origins: list[str] = ["http://localhost:3000"]
    session_max_age_seconds: int = 8 * 3600
    cookie_secure: bool = False
    log_level: str = "INFO"

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
