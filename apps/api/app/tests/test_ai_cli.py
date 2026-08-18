"""CliChatProvider — inference through a local `claude`/`codex` CLI.

The real CLIs are never invoked here (that would spend someone's subscription and need the
network): a fake executable named `claude` is planted on PATH instead. What matters is the
contract — prompt over stdin, reply from stdout, loud failures — because a silent CLI failure
would degrade every daily summary into an error with no obvious cause.
"""

import os
import stat
from pathlib import Path

import pytest

from app.ai.provider import CliChatProvider, FallbackProvider, HttpChatProvider, get_provider
from app.config import Settings


def _fake_cli(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, script: str) -> None:
    """Plant an executable named `claude` at the FRONT of PATH."""
    cli = tmp_path / "claude"
    cli.write_text(f"#!/bin/sh\n{script}\n")
    cli.chmod(cli.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ.get('PATH', '')}")


async def test_prompt_goes_over_stdin_and_reply_comes_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # `cat` echoes stdin, so the reply proves both directions AND that system+user made it in.
    _fake_cli(tmp_path, monkeypatch, "cat")

    reply = await CliChatProvider(cli="claude").complete("SYSTEM RULES", "the digest")

    assert "SYSTEM RULES" in reply
    assert "the digest" in reply


async def test_model_flag_is_passed_when_configured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_cli(tmp_path, monkeypatch, 'cat > /dev/null; echo "args: $@"')

    reply = await CliChatProvider(cli="claude", model="claude-haiku-4-5").complete("s", "u")

    assert "--model claude-haiku-4-5" in reply


async def test_nonzero_exit_raises_with_stderr(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_cli(tmp_path, monkeypatch, 'cat > /dev/null; echo "quota exhausted" >&2; exit 3')

    with pytest.raises(RuntimeError, match="exited 3.*quota exhausted"):
        await CliChatProvider(cli="claude").complete("s", "u")


async def test_empty_output_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """An empty summary must be an ERROR, not an empty recap delivered as if it were real."""
    _fake_cli(tmp_path, monkeypatch, "cat > /dev/null")

    with pytest.raises(RuntimeError, match="no output"):
        await CliChatProvider(cli="claude").complete("s", "u")


async def test_hung_cli_times_out(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_cli(tmp_path, monkeypatch, "sleep 30")

    with pytest.raises(RuntimeError, match="timed out"):
        await CliChatProvider(cli="claude", timeout=0.3).complete("s", "u")


async def test_missing_binary_fails_with_a_pointed_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The expected real-world failure: works in an interactive shell, fails under a service
    # manager whose PATH lacks the nvm/node shims the `claude` launcher needs.
    monkeypatch.setenv("PATH", "/nonexistent")

    with pytest.raises(RuntimeError, match="not on the server's PATH"):
        await CliChatProvider(cli="claude").complete("s", "u")


def test_unknown_cli_name_is_rejected_at_construction() -> None:
    with pytest.raises(ValueError, match="Unknown AI CLI"):
        CliChatProvider(cli="gemini")


def test_engine_order_cli_then_key_then_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """ai_cli wins over an API key; no config at all means the offline fallback."""

    def with_settings(**kwargs: str) -> object:
        monkeypatch.setattr(
            "app.ai.provider.get_settings", lambda: Settings(_env_file=None, **kwargs)
        )
        return get_provider()

    assert isinstance(with_settings(ai_cli="claude", ai_api_key="sk-x"), CliChatProvider)
    assert isinstance(
        with_settings(ai_api_key="sk-x", ai_base_url="https://api.example.com/v1"),
        HttpChatProvider,
    )
    assert isinstance(with_settings(), FallbackProvider)
