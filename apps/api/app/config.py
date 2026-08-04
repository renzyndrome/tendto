from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, loaded from environment / .env (see .env.example)."""

    database_url: str = "postgresql+asyncpg://tendto:tendto@localhost:15432/tendto"
    # better-auth service (apps/auth) — issuer/JWKS for stateless JWT verification
    auth_issuer: str = "http://localhost:13001"
    auth_jwks_url: str = "http://localhost:13001/api/auth/jwks"
    auth_audience: str = "tendto"
    powersync_url: str = "http://localhost:18080"
    # Public web origin, used for CORS (Vite dev server by default)
    web_url: str = "http://localhost:15173"
    # AI layer (doc 06). An empty ai_api_key selects the offline FallbackProvider (no network,
    # no key), which keeps dev and the whole test suite network-free. Set these to point at an
    # OpenAI-compatible endpoint — a hosted API or a self-hosted Ollama server's /v1 base URL.
    ai_base_url: str = ""
    ai_api_key: str = ""
    ai_model: str = "gpt-4o-mini"
    # Transactional email (workspace invites). An empty email_api_key selects the offline
    # ConsoleProvider — the invite is still created and its link still works, it just isn't
    # delivered, so dev and tests stay network-free (same contract as ai_api_key above).
    email_api_key: str = ""
    email_from: str = "TendTo <invites@tendto.app>"
    email_base_url: str = "https://api.resend.com"
    # How long an invite link stays valid.
    invite_ttl_hours: int = 168  # 7 days

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
