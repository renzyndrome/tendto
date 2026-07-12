"""Provider-agnostic chat completions (doc 06 §sub-layers).

Features never hard-code a vendor — they depend on the `ChatProvider` Protocol. With no API
key configured, `FallbackProvider` runs entirely offline (no network), so dev and tests need
no credentials, and TendTo's "bring-your-own-key / self-hosted Ollama" stance is the default.
"""

from typing import Protocol

import httpx

from app.config import get_settings


class ChatProvider(Protocol):
    """A minimal chat-completion port. One system message, one user message, one string back."""

    async def complete(self, system: str, user: str) -> str: ...


class HttpChatProvider:
    """OpenAI-compatible chat completions — hosted APIs or a self-hosted Ollama /v1 endpoint."""

    def __init__(self, *, base_url: str, api_key: str, model: str, timeout: float = 30.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def complete(self, system: str, user: str) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self._base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
            response.raise_for_status()
            data = response.json()
        return data["choices"][0]["message"]["content"]


class FallbackProvider:
    """No network, no key: a deterministic recap so the daily summary still works offline and
    in tests. The `user` message is already the rendered activity digest (see
    summary.render_activity), so presenting it back yields a faithful, un-prettified summary."""

    async def complete(self, system: str, user: str) -> str:
        body = user.strip() or "No tracked activity — a calm day."
        return f"Your day at a glance\n\n{body}"


def get_provider() -> ChatProvider:
    """Factory, and a FastAPI dependency. Returns the offline FallbackProvider unless an API
    key is configured. Override via `app.dependency_overrides[get_provider]` in tests."""
    settings = get_settings()
    if not settings.ai_api_key:
        return FallbackProvider()
    return HttpChatProvider(
        base_url=settings.ai_base_url,
        api_key=settings.ai_api_key,
        model=settings.ai_model,
    )
