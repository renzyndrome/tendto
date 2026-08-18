from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# The repo-root .env, located from THIS file — never from the process CWD. Uvicorn is started
# with `cd apps/api` (scripts/e2e-stack.sh), so a relative env_file silently resolved to the
# nonexistent apps/api/.env and the API ran on defaults; nobody noticed for weeks because every
# default matches the dev ports. Real environment variables still take precedence, and a
# missing file (prod containers) is ignored — this only fixes where the DEV file is found.
_REPO_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


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
    # AI layer (doc 06). Three engines behind one port, picked in this order:
    #   1. ai_cli ("claude" or "codex") — shell out to an installed, subscription-authenticated
    #      CLI. No API key, no per-token billing; dev/self-host only (see provider.py).
    #   2. ai_api_key — an OpenAI-compatible HTTP endpoint: OpenAI, Anthropic's compat endpoint
    #      (https://api.anthropic.com/v1), or a self-hosted Ollama server's /v1 base URL.
    #   3. Neither — the offline FallbackProvider (no network), which keeps dev and the whole
    #      test suite network-free.
    ai_cli: str = ""
    ai_cli_model: str = ""  # optional --model override for the CLI; empty = the CLI's default
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

    model_config = SettingsConfigDict(env_file=_REPO_ROOT_ENV, extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
