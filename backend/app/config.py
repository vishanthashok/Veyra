
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VEYRA_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://veyra:veyra@localhost:5432/veyra"
    secret_key: str = "dev-only-change-me"
    max_upload_bytes: int = 10 * 1024 * 1024
    cors_origins: list[str] = ["http://localhost:3000"]
    session_max_age_seconds: int = 8 * 3600
    cookie_secure: bool = False


settings = Settings()
