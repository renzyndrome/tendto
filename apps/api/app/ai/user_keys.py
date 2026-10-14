"""A user's own AI key: stored encrypted, used for that user's requests in place of the operator's.

The operator's engine (AI_CLI / AI_API_KEY in .env, app/ai/provider.py) serves everyone who has
not set a key of their own. A user who has set one in Personalization > AI gets an
OpenAI-compatible HTTP engine with THEIR key and model instead, so their usage is on their own
account. The CLI stays where it was: the desktop app runs the user's own CLI on their machine,
and the server's CLI is the operator's, set in .env.

The key never leaves the server once saved: GET /ai/settings returns its last four characters
only, and nothing here logs it. It is encrypted with a key derived from AI_KEYS_SECRET, and the
feature is off without one, since a key stored without it would sit in the database as plain
text. A key that no longer decrypts (the secret changed) turns AI OFF for that user until they
enter it again, rather than quietly sending their text to the operator's engine on the
operator's bill: they chose their own account, and falling back would undo that choice.
"""

import base64
import hashlib
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.provider import ChatProvider, FallbackProvider, HttpChatProvider, get_provider
from app.auth import CurrentUser, get_current_user
from app.config import get_settings
from app.db import get_session
from app.models.core import UserAiSettings


@dataclass(frozen=True)
class Preset:
    label: str
    base_url: str
    default_model: str


#: OpenAI-compatible endpoints a key can be used with. Fixed URLs, so on a shared instance a
#: user's key can only ever make the server call one of these.
PRESETS: dict[str, Preset] = {
    "openai": Preset("OpenAI", "https://api.openai.com/v1", "gpt-4o-mini"),
    "anthropic": Preset("Anthropic", "https://api.anthropic.com/v1", "claude-haiku-5-5"),
    "openrouter": Preset("OpenRouter", "https://openrouter.ai/api/v1", "openai/gpt-4o-mini"),
    "gemini": Preset(
        "Google Gemini",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "gemini-2.5-flash",
    ),
}

#: A URL of the user's own. Only when the operator allows it (AI_ALLOW_CUSTOM_URL).
CUSTOM = "custom"

#: Shortest AI_KEYS_SECRET accepted. The Fernet key is a plain SHA-256 of it, so a short secret
#: could be guessed offline from a database dump. Shorter turns the feature off.
MIN_SECRET_LENGTH = 32

#: What a key may contain: printable ASCII, no spaces or line breaks. A key goes into an HTTP
#: header, and a line break there makes the HTTP library raise an error that QUOTES the header,
#: which `logger.exception` would then write, key and all, to the server log.
_KEY_SHAPE = re.compile(r"[\x21-\x7e]{8,500}")


class OwnKeyProvider(HttpChatProvider):
    """The HTTP engine, on a user's own key. Named apart so /ai/status can say which it is."""

    name = "own-key"


def _fernet() -> Fernet | None:
    secret = get_settings().ai_keys_secret
    if len(secret) < MIN_SECRET_LENGTH:
        return None
    # Any string the operator chose becomes a valid Fernet key; Fernet needs exactly 32 bytes.
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def keys_enabled() -> bool:
    return _fernet() is not None


def custom_allowed() -> bool:
    return get_settings().ai_allow_custom_url


def encrypt_key(api_key: str) -> str:
    fernet = _fernet()
    if fernet is None:
        raise RuntimeError("AI_KEYS_SECRET is not set")
    return fernet.encrypt(api_key.encode()).decode()


def decrypt_key(token: str) -> str | None:
    """The key, or None when it cannot be read (no secret, or a different one)."""
    fernet = _fernet()
    if fernet is None:
        return None
    try:
        return fernet.decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def is_key_shaped(api_key: str) -> bool:
    return _KEY_SHAPE.fullmatch(api_key) is not None


def key_hint(api_key: str) -> str:
    """The last four characters, and only for a key long enough that they give nothing away."""
    return f"…{api_key[-4:]}" if len(api_key) >= 12 else "…"


def is_http_url(value: str) -> bool:
    """An http(s) URL with a host and no credentials in it. Credentials would be echoed back
    by GET /ai/settings and could appear in a logged HTTP error."""
    parts = urlsplit(value)
    return (
        parts.scheme in {"http", "https"}
        and bool(parts.hostname)
        and parts.username is None
        and parts.password is None
    )


def base_url_for(row: UserAiSettings) -> str:
    if row.provider == CUSTOM:
        return row.base_url if custom_allowed() else ""
    preset = PRESETS.get(row.provider)
    return preset.base_url if preset else ""


async def load_settings(session: AsyncSession, user_id: str) -> UserAiSettings | None:
    return await session.scalar(select(UserAiSettings).where(UserAiSettings.user_id == user_id))


def provider_from(row: UserAiSettings) -> OwnKeyProvider | None:
    """An engine on the user's key, or None when the row cannot serve (unreadable key, unknown
    provider, or a custom URL the operator has since disallowed)."""
    api_key = decrypt_key(row.api_key_encrypted)
    base_url = base_url_for(row)
    # The shape check again, for a key stored before it existed: never put a bad one in a header.
    if api_key is None or not is_key_shaped(api_key) or not base_url:
        return None
    return OwnKeyProvider(base_url=base_url, api_key=api_key, model=row.model)


async def get_request_provider(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    default: ChatProvider = Depends(get_provider),
) -> ChatProvider:
    """The engine for THIS request. A FastAPI dependency; tests still override `get_provider`.

    - No own key: the operator's engine.
    - A usable own key: an engine on it.
    - An own key that cannot be used (unreadable, or a custom URL since disallowed): no engine.
      The user chose their own account, so their text does not go to the operator's instead.
    """
    row = await load_settings(session, user.id)
    if row is None:
        return default
    own = provider_from(row)
    return own if own is not None else FallbackProvider()
