"""CORS origins: the web app AND the desktop shell must both be able to call this API.

The desktop shell's webview does not serve from `WEB_URL` — Tauri uses its own origin
(`tauri://localhost` on Linux/macOS, `http://tauri.localhost` on Windows). Before Phase 4 the
allowlist was the single `WEB_URL`, so every desktop request would have failed preflight with an
error that reads like a broken session rather than a CORS problem. These tests pin the parsing
and the actual middleware behaviour so that regression cannot come back quietly.
"""

import pytest

from app.config import DESKTOP_ORIGINS, Settings


def test_blank_web_origins_still_allows_the_web_app_and_the_desktop_shell() -> None:
    origins = Settings(web_url="https://tendto.example", web_origins="").cors_origins
    assert origins[0] == "https://tendto.example"
    for desktop in DESKTOP_ORIGINS:
        assert desktop in origins


def test_web_origins_is_parsed_as_a_comma_list_and_trimmed() -> None:
    settings = Settings(
        web_url="https://tendto.example",
        web_origins=" https://staging.tendto.example , https://other.example ",
    )
    assert settings.cors_origins[:3] == [
        "https://tendto.example",
        "https://staging.tendto.example",
        "https://other.example",
    ]


def test_setting_web_origins_does_not_drop_the_desktop_shell() -> None:
    """WEB_ORIGINS only ever ADDS.

    If the desktop origins were a fallback used only when WEB_ORIGINS is blank, an operator adding
    a staging domain would silently break every desktop client — the exact CORS-failure-that-looks-
    like-an-auth-bug this configuration exists to avoid.
    """
    settings = Settings(
        web_url="https://tendto.example", web_origins="https://staging.tendto.example"
    )
    for desktop in DESKTOP_ORIGINS:
        assert desktop in settings.cors_origins


def test_web_url_is_always_allowed_even_if_web_origins_omits_it() -> None:
    """An operator who sets WEB_ORIGINS to something else must not lock out the web app."""
    settings = Settings(web_url="https://tendto.example", web_origins="https://other.example")
    assert settings.cors_origins[0] == "https://tendto.example"


def test_no_duplicates_when_an_origin_is_named_twice() -> None:
    settings = Settings(web_url="https://tendto.example", web_origins="https://tendto.example")
    assert settings.cors_origins.count("https://tendto.example") == 1


@pytest.mark.asyncio
async def test_preflight_from_the_desktop_webview_is_allowed(client) -> None:
    """The real middleware, not just the parsing: a desktop upload must survive preflight."""
    response = await client.options(
        "/sync/upload",
        headers={
            "Origin": "tauri://localhost",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "tauri://localhost"


@pytest.mark.asyncio
async def test_preflight_from_an_unknown_origin_is_not_allowed(client) -> None:
    response = await client.options(
        "/sync/upload",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in response.headers
