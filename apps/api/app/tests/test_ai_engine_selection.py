"""Which engine an operator gets for a given configuration.

This is the "I set up my AI account, why isn't it working?" surface. Every row here was a real
way to be configured and get nothing: an OpenAI key with no base URL used to resolve to a
relative `/chat/completions`, because `.env.example` ships `AI_BASE_URL=` with nothing after it
and pydantic treats that empty string as a deliberate value rather than as "unset".
"""

import pytest

from app.ai.provider import CliChatProvider, FallbackProvider, HttpChatProvider, get_provider
from app.config import OPENAI_BASE_URL, Settings


def _settings(**overrides: str) -> Settings:
    """Constructor kwargs beat the environment, so this ignores the developer's own .env."""
    base = {"ai_cli": "", "ai_cli_model": "", "ai_base_url": "", "ai_api_key": "", "ai_model": ""}
    return Settings(**{**base, **overrides})


def test_a_blank_base_url_falls_back_to_openai() -> None:
    """`AI_BASE_URL=` (the shape the example file ships) must mean "unset", not "empty"."""
    assert _settings(ai_api_key="sk-test").ai_base_url == OPENAI_BASE_URL


def test_a_blank_model_falls_back_too() -> None:
    assert _settings(ai_api_key="sk-test").ai_model == "gpt-4o-mini"


def test_an_explicit_base_url_is_kept() -> None:
    for url in ("https://api.anthropic.com/v1", "http://localhost:11434/v1"):
        assert _settings(ai_api_key="k", ai_base_url=url).ai_base_url == url


def test_surrounding_whitespace_is_trimmed() -> None:
    """A trailing space in a .env line is invisible and would otherwise break the URL."""
    assert _settings(ai_base_url="  https://example.test/v1  ").ai_base_url == (
        "https://example.test/v1"
    )


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        # A subscription CLI wins: no key, no per-token bill.
        ({"ai_cli": "claude"}, CliChatProvider),
        ({"ai_cli": "codex"}, CliChatProvider),
        # An API key alone is enough — this is the OpenAI/ChatGPT case.
        ({"ai_api_key": "sk-test"}, HttpChatProvider),
        # A key plus somebody else's endpoint (Anthropic, Ollama) is the same path.
        ({"ai_api_key": "k", "ai_base_url": "https://api.anthropic.com/v1"}, HttpChatProvider),
        # Nothing configured: offline, and every AI affordance hides itself.
        ({}, FallbackProvider),
    ],
)
def test_engine_selection(monkeypatch: pytest.MonkeyPatch, overrides: dict, expected: type) -> None:
    settings = _settings(**overrides)
    monkeypatch.setattr("app.ai.provider.get_settings", lambda: settings)

    assert isinstance(get_provider(), expected)


def test_a_configured_engine_reports_itself_as_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`/ai/status` gates every AI affordance on this, including the evening recap's prose."""
    for overrides, name in (
        ({"ai_cli": "claude"}, "claude-cli"),
        ({"ai_cli": "codex"}, "codex-cli"),
        ({"ai_api_key": "sk-test"}, "api"),
        ({}, "offline"),
    ):
        settings = _settings(**overrides)
        monkeypatch.setattr("app.ai.provider.get_settings", lambda s=settings: s)
        assert get_provider().name == name
