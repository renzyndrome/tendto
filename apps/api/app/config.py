from functools import lru_cache
from pathlib import Path

from pydantic import ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The repo-root .env, located from THIS file — never from the process CWD. Uvicorn is started
# with `cd apps/api` (scripts/e2e-stack.sh), so a relative env_file silently resolved to the
# nonexistent apps/api/.env and the API ran on defaults; nobody noticed for weeks because every
# default matches the dev ports. Real environment variables still take precedence, and a
# missing file (prod containers) is ignored — this only fixes where the DEV file is found.
#
# The length check is not defensive padding: in the production image the app lives at
# /app/app/config.py, which has only three parents, so indexing the fourth raised IndexError at
# import time and the API container could never start at all. There is no repo root in a
# container, and none is wanted — the environment supplies everything there.
_CONFIG_FILE = Path(__file__).resolve()
_REPO_ROOT_ENV = _CONFIG_FILE.parents[3] / ".env" if len(_CONFIG_FILE.parents) > 3 else None


#: The commonest AI endpoint, and what `ai_model`'s default assumes.
OPENAI_BASE_URL = "https://api.openai.com/v1"

#: The desktop shell's webview origins. Tauri serves the bundle from a custom scheme rather than
#: from web_url, so these must be allowed explicitly by both this API and the auth service.
DESKTOP_ORIGINS = ("tauri://localhost", "http://tauri.localhost")


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
    # Extra browser origins allowed to call this API, comma-separated. The desktop shell's
    # webview is NOT web_url — Tauri serves the bundle from its own origin — so it has to be
    # named here or every request from the desktop app fails CORS preflight. Blank means
    # "web_url plus the two Tauri origins" (see cors_origins).
    web_origins: str = ""
    # AI layer (doc 06). Three engines behind one port, picked in this order:
    #   1. ai_cli ("claude" or "codex") — shell out to an installed, subscription-authenticated
    #      CLI. No API key, no per-token billing; dev/self-host only (see provider.py).
    #   2. ai_api_key — an OpenAI-compatible HTTP endpoint: OpenAI, Anthropic's compat endpoint
    #      (https://api.anthropic.com/v1), or a self-hosted Ollama server's /v1 base URL.
    #   3. Neither — the offline FallbackProvider (no network), which keeps dev and the whole
    #      test suite network-free.
    ai_cli: str = ""
    ai_cli_model: str = ""  # optional --model override for the CLI; empty = the CLI's default
    # Defaults to OpenAI, matching `ai_model` below — so setting AI_API_KEY alone is enough for
    # the commonest case. It used to default to "", which made an OpenAI key resolve to a
    # relative "/chat/completions" and fail with an unhelpful protocol error.
    ai_base_url: str = OPENAI_BASE_URL
    ai_api_key: str = ""
    ai_model: str = "gpt-4o-mini"

    @field_validator("ai_base_url", "ai_model", mode="after")
    @classmethod
    def _fall_back_when_blank(cls, value: str, info: ValidationInfo) -> str:
        """Treat a blank entry as "unset", not as an empty value.

        `.env` files carry keys with nothing after the `=` all the time — that is how the
        example file ships them. Pydantic treats "" as a real value that overrides the default,
        so an operator who filled in only AI_API_KEY got an empty base URL and a confusing
        protocol error rather than the OpenAI default they obviously meant.
        """
        if value.strip():
            return value.strip()
        return OPENAI_BASE_URL if info.field_name == "ai_base_url" else "gpt-4o-mini"

    # Transactional email (workspace invites). An empty email_api_key selects the offline
    # ConsoleProvider — the invite is still created and its link still works, it just isn't
    # delivered, so dev and tests stay network-free (same contract as ai_api_key above).
    email_api_key: str = ""
    email_from: str = "TendTo <invites@tendto.app>"
    email_base_url: str = "https://api.resend.com"
    # How long an invite link stays valid.
    invite_ttl_hours: int = 168  # 7 days

    @property
    def cors_origins(self) -> list[str]:
        """Browser origins allowed to call this API.

        `web_url` and the two Tauri origins are ALWAYS included. The Tauri pair is the desktop
        shell's webview (`tauri://` on Linux/macOS, `http://tauri.localhost` on Windows); they are
        unconditional rather than a fallback, so an operator who sets WEB_ORIGINS to add a staging
        domain cannot silently break the desktop app. Forgetting them produces a CORS failure that
        reads like an auth bug, which is the whole reason this is not left to configuration.
        WEB_ORIGINS therefore only ever ADDS origins.

        Order is preserved and duplicates dropped, so the list reads the same as it was written.
        """
        named = [origin.strip() for origin in self.web_origins.split(",") if origin.strip()]
        return list(dict.fromkeys([self.web_url, *named, *DESKTOP_ORIGINS]))

    model_config = SettingsConfigDict(env_file=_REPO_ROOT_ENV, extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
