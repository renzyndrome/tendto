from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, loaded from environment / .env (see .env.example)."""

    database_url: str = "postgresql+asyncpg://tendto:tendto@localhost:5432/tendto"
    clerk_issuer: str = ""
    clerk_jwks_url: str = ""
    powersync_url: str = "http://localhost:8080"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
