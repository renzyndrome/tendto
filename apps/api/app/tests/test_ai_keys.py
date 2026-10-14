"""A user's own AI key: /ai/settings, and the engine their requests then run on.

The key goes in and never comes back out; it is stored encrypted; the feature is off without a
server secret; and a key that no longer decrypts falls back to the operator's engine rather than
failing. No test here makes a real model call: the engine is inspected, never run.
"""

from collections.abc import Iterator
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.ai.provider import FallbackProvider, get_provider
from app.ai.user_keys import OwnKeyProvider, get_request_provider
from app.auth import CurrentUser
from app.config import get_settings
from app.main import app
from app.models.core import UserAiSettings
from app.tests.support import TEST_USER_ID, TestSession

KEY = "sk-test-0123456789abcd"


@pytest.fixture
def secret(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(get_settings(), "ai_keys_secret", "test-secret-for-own-keys-" + "x" * 16)
    monkeypatch.setattr(get_settings(), "ai_allow_custom_url", False)
    yield


async def _save(client: AsyncClient, **body: Any) -> Any:
    return await client.put("/ai/settings", json={"provider": "openai", **body})


async def _stored() -> UserAiSettings | None:
    async with TestSession() as session:
        return await session.scalar(
            select(UserAiSettings).where(UserAiSettings.user_id == TEST_USER_ID)
        )


class OperatorEngine:
    """Stands in for the operator's engine. Never called."""

    name = "operator"


async def _engine() -> object:
    """The engine a request from the test user would run on. Resolved directly: nothing is
    called."""
    async with TestSession() as session:
        return await get_request_provider(
            user=CurrentUser(id=TEST_USER_ID), session=session, default=OperatorEngine()
        )


async def test_saving_a_key_never_returns_it_and_stores_it_encrypted(
    client: AsyncClient, secret: None
) -> None:
    res = await _save(client, api_key=KEY, model="gpt-4o")

    assert res.status_code == 200
    body = res.json()
    assert KEY not in res.text
    assert body["configured"] is True
    assert body["provider"] == "openai"
    assert body["model"] == "gpt-4o"
    assert body["key_hint"] == "…abcd"
    stored = await _stored()
    assert stored is not None
    assert KEY not in stored.api_key_encrypted

    again = await client.get("/ai/settings")
    assert KEY not in again.text
    assert again.json()["key_readable"] is True


async def test_requests_run_on_the_users_own_key(client: AsyncClient, secret: None) -> None:
    await _save(client, provider="anthropic", api_key=KEY, model="")

    engine = await _engine()

    assert isinstance(engine, OwnKeyProvider)
    assert engine._base_url == "https://api.anthropic.com/v1"
    assert engine._model == "claude-haiku-5-5"  # the preset's default, as no model was given
    assert engine._api_key == KEY


async def test_status_reports_the_own_key_engine(client: AsyncClient, secret: None) -> None:
    app.dependency_overrides[get_provider] = lambda: FallbackProvider()
    try:
        before = (await client.get("/ai/status")).json()
        await _save(client, api_key=KEY)
        after = (await client.get("/ai/status")).json()
    finally:
        app.dependency_overrides.pop(get_provider, None)

    assert (before["engine"], before["available"]) == ("offline", False)
    assert (after["engine"], after["available"]) == ("own-key", True)


async def test_changing_the_model_keeps_the_stored_key(client: AsyncClient, secret: None) -> None:
    await _save(client, api_key=KEY)

    res = await _save(client, model="gpt-4.1-mini")

    assert res.status_code == 200
    engine = await _engine()
    assert isinstance(engine, OwnKeyProvider)
    assert engine._model == "gpt-4.1-mini"
    assert engine._api_key == KEY


async def test_switching_provider_needs_a_new_key(client: AsyncClient, secret: None) -> None:
    await _save(client, api_key=KEY)

    res = await _save(client, provider="anthropic")

    assert res.status_code == 422
    stored = await _stored()
    assert stored is not None
    assert stored.provider == "openai"


async def test_a_first_save_needs_a_key(client: AsyncClient, secret: None) -> None:
    res = await _save(client, model="gpt-4o")

    assert res.status_code == 422
    assert await _stored() is None


async def test_removing_the_key_returns_to_the_operators_engine(
    client: AsyncClient, secret: None
) -> None:
    await _save(client, api_key=KEY)

    res = await client.delete("/ai/settings")

    assert res.status_code == 204
    assert await _stored() is None
    assert isinstance(await _engine(), OperatorEngine)


async def test_without_a_server_secret_nothing_is_stored(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "ai_keys_secret", "")

    res = await _save(client, api_key=KEY)

    assert res.status_code == 503
    assert await _stored() is None
    assert (await client.get("/ai/settings")).json()["enabled"] is False


async def test_a_key_that_no_longer_decrypts_turns_ai_off_rather_than_falling_back(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, secret: None
) -> None:
    """The user chose their own account: their text must not quietly go to the operator's."""
    await _save(client, api_key=KEY)
    monkeypatch.setattr(get_settings(), "ai_keys_secret", "a-different-secret-" + "y" * 20)

    assert isinstance(await _engine(), FallbackProvider)
    assert (await client.get("/ai/settings")).json()["key_readable"] is False


async def test_a_short_server_secret_leaves_the_feature_off(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "ai_keys_secret", "too-short")

    assert (await _save(client, api_key=KEY)).status_code == 503


async def test_a_key_with_whitespace_is_refused(client: AsyncClient, secret: None) -> None:
    """A line break would reach an HTTP header, and the library's error would quote it into the
    server log."""
    res = await _save(client, api_key="sk-test-0123\nX-Injected: 1")

    assert res.status_code == 422
    assert await _stored() is None


async def test_unknown_providers_and_custom_urls_are_refused(
    client: AsyncClient, secret: None
) -> None:
    unknown = await _save(client, provider="evil", api_key=KEY)
    custom = await _save(
        client, provider="custom", api_key=KEY, base_url="http://169.254.169.254", model="x"
    )

    assert unknown.status_code == 422
    # Off unless the operator allows it: the SERVER would make the request.
    assert custom.status_code == 422
    assert await _stored() is None


async def test_a_custom_url_when_the_operator_allows_it(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, secret: None
) -> None:
    monkeypatch.setattr(get_settings(), "ai_allow_custom_url", True)

    bad = await _save(client, provider="custom", api_key=KEY, base_url="ftp://x", model="m")
    creds = await _save(
        client, provider="custom", api_key=KEY, base_url="https://u:p@host/v1", model="m"
    )
    good = await _save(
        client, provider="custom", api_key=KEY, base_url="http://localhost:11434/v1/", model="m"
    )

    assert bad.status_code == 422
    assert creds.status_code == 422
    assert good.status_code == 200
    engine = await _engine()
    assert isinstance(engine, OwnKeyProvider)
    assert engine._base_url == "http://localhost:11434/v1"
