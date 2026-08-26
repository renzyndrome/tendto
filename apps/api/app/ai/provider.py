"""Provider-agnostic chat completions (doc 06 §sub-layers).

Features never hard-code a vendor — they depend on the `ChatProvider` Protocol. Three engines:

- `CliChatProvider`: shells out to an installed `claude` or `codex` CLI, so a dev/self-host
  instance runs on the operator's existing subscription with no API key and no per-token bill.
- `HttpChatProvider`: any OpenAI-compatible endpoint (OpenAI, Anthropic's compat endpoint,
  self-hosted Ollama).
- `FallbackProvider`: no key, no network — dev and tests need no credentials, and TendTo's
  "bring-your-own-key / self-hosted" stance is the default.
"""

import asyncio
import json
import shutil
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path
from typing import ClassVar, Protocol, runtime_checkable

import httpx

from app.config import get_settings


class ChatProvider(Protocol):
    """A minimal chat-completion port. One system message, one user message, one string back."""

    async def complete(self, system: str, user: str) -> str: ...


@runtime_checkable
class StreamingChatProvider(Protocol):
    """A provider that can emit text as it is generated.

    Optional on purpose: the offline fallback has nothing to stream, and a CLI we have not
    verified should not pretend to. Callers check with `isinstance(provider,
    StreamingChatProvider)` and fall back to `complete()`, so a provider gains streaming by
    growing the method — no registry to keep in step.
    """

    async def stream(self, system: str, user: str) -> AsyncIterator[str]: ...


class HttpChatProvider:
    """OpenAI-compatible chat completions — hosted APIs or a self-hosted Ollama /v1 endpoint."""

    name = "api"

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

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:
        """Server-sent chunks from an OpenAI-compatible endpoint.

        The wire format is `data: {json}` lines terminated by `data: [DONE]`. Malformed lines
        are skipped rather than raising: one bad frame should not lose a response that is
        otherwise arriving fine.
        """
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": True,
        }
        async with (
            httpx.AsyncClient(timeout=self._timeout) as client,
            client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
            ) as response,
        ):
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                body = line[len("data:") :].strip()
                if body == "[DONE]":
                    return
                try:
                    chunk = json.loads(body)
                    piece = chunk["choices"][0]["delta"].get("content")
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                if piece:
                    yield piece


class CliChatProvider:
    """Inference through an installed coding-agent CLI (`claude -p` / `codex exec`).

    Why this exists: a dev or self-host instance usually belongs to someone who already pays
    for a Claude or ChatGPT subscription, and the CLIs expose that inference headlessly. This
    is deliberately a DEV/SELF-HOST convenience, not a SaaS path — a hosted multi-tenant
    deployment must use API keys, both for the vendors' subscription terms (one person's plan
    serving other users) and because the CLI runs as a real process on the server host.

    Containment, since the prompt embeds user content (titles) that could try to steer an
    agentic CLI: the prompt travels over STDIN (argv leaks into `ps` and has length limits),
    the subprocess runs in an empty scratch directory so file-reading tools have nothing to
    find, and `claude` gets `--max-turns 1` so there is no tool-use round trip at all.
    """

    # Verified argv shapes. `claude -p` reads the prompt from stdin and prints the reply to
    # stdout (smoke-tested headless). `codex exec -` is the documented equivalent but is
    # UNVERIFIED here — no codex install to test against; revisit flags when one exists.
    _COMMANDS: ClassVar[dict[str, tuple[str, ...]]] = {
        "claude": ("claude", "-p", "--max-turns", "1"),
        "codex": ("codex", "exec", "--skip-git-repo-check", "-"),
    }

    #: Extra argv for token-by-token output. Verified against `claude` on 2026-08-21: without
    #: `--include-partial-messages` the CLI emits the whole reply as a single event, so
    #: stream-json ALONE buys nothing. `--verbose` is required alongside stream-json under -p.
    #: Absent for `codex`, whose argv is unverified — it simply does not stream.
    _STREAM_ARGS: ClassVar[dict[str, tuple[str, ...]]] = {
        "claude": ("--output-format", "stream-json", "--include-partial-messages", "--verbose"),
    }

    def __init__(self, *, cli: str, model: str = "", timeout: float = 120.0) -> None:
        if cli not in self._COMMANDS:
            raise ValueError(f"Unknown AI CLI '{cli}' (known: {sorted(self._COMMANDS)})")
        self._cli = cli
        self._model = model
        self._timeout = timeout
        self.name = f"{cli}-cli"

    async def complete(self, system: str, user: str) -> str:
        argv = list(self._COMMANDS[self._cli])
        if self._model:
            argv += ["--model", self._model]
        # PATH is resolved eagerly for a clear error — `claude` under nvm also needs `node`
        # on PATH, so "works in my shell, fails under systemd" is the expected failure mode.
        if shutil.which(argv[0]) is None:
            raise RuntimeError(
                f"AI_CLI is '{self._cli}' but '{argv[0]}' is not on the server's PATH"
            )
        # System + user in one stdin document: -p mode takes a single prompt, and keeping the
        # static instructions first preserves their priority over embedded user content.
        prompt = f"{system}\n\n---\n\n{user}\n"

        scratch = Path(tempfile.mkdtemp(prefix="tendto-ai-"))
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=scratch,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(prompt.encode()), timeout=self._timeout
                )
            except TimeoutError:
                process.kill()
                await process.wait()
                raise RuntimeError(f"{self._cli} timed out after {self._timeout:.0f}s") from None
            if process.returncode != 0:
                detail = stderr.decode(errors="replace").strip()[:500]
                raise RuntimeError(f"{self._cli} exited {process.returncode}: {detail}")
            text = stdout.decode(errors="replace").strip()
            if not text:
                raise RuntimeError(f"{self._cli} returned no output")
            return text
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:
        """Token deltas from the CLI's newline-delimited JSON stream.

        The shape (verified, not guessed):
          {"type":"stream_event","event":{"type":"content_block_delta",
           "delta":{"type":"text_delta","text":"..."}}}
        Everything else on that stream — session lines, hook lifecycle, rate-limit notices — is
        ignored. Anything unparseable is skipped rather than raised: a single odd line should
        not lose a reply that is otherwise arriving.

        Same containment as `complete`: prompt over stdin, empty scratch cwd, one turn.
        """
        stream_args = self._STREAM_ARGS.get(self._cli)
        if stream_args is None:  # pragma: no cover - only reachable for an unverified CLI
            raise RuntimeError(f"{self._cli} does not support streaming")
        argv = [*self._COMMANDS[self._cli], *stream_args]
        if self._model:
            argv += ["--model", self._model]
        if shutil.which(argv[0]) is None:
            raise RuntimeError(
                f"AI_CLI is '{self._cli}' but '{argv[0]}' is not on the server's PATH"
            )
        prompt = f"{system}\n\n---\n\n{user}\n"

        scratch = Path(tempfile.mkdtemp(prefix="tendto-ai-"))
        process = None
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                cwd=scratch,
                # The CLI writes many small JSON lines; the default 64KB limit is ample, but a
                # single huge line would otherwise raise LimitOverrunError mid-stream.
                limit=1024 * 1024,
            )
            assert process.stdin is not None and process.stdout is not None
            process.stdin.write(prompt.encode())
            await process.stdin.drain()
            process.stdin.close()

            deadline = asyncio.get_running_loop().time() + self._timeout
            while True:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise RuntimeError(f"{self._cli} timed out after {self._timeout:.0f}s")
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), timeout=remaining)
                except TimeoutError:
                    raise RuntimeError(
                        f"{self._cli} timed out after {self._timeout:.0f}s"
                    ) from None
                if not line:
                    break
                piece = _cli_delta(line)
                if piece:
                    yield piece
        finally:
            # Covers the caller abandoning the generator half-way (the browser navigating away),
            # which is otherwise a subprocess left running until its own timeout.
            if process is not None and process.returncode is None:
                process.kill()
                await process.wait()
            shutil.rmtree(scratch, ignore_errors=True)


def _cli_delta(line: bytes) -> str:
    """The text of one `content_block_delta` line, or "" for every other kind of line."""
    try:
        event = json.loads(line)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return ""
    if not isinstance(event, dict) or event.get("type") != "stream_event":
        return ""
    inner = event.get("event")
    if not isinstance(inner, dict) or inner.get("type") != "content_block_delta":
        return ""
    delta = inner.get("delta")
    if not isinstance(delta, dict) or delta.get("type") != "text_delta":
        return ""
    text = delta.get("text")
    return text if isinstance(text, str) else ""


class FallbackProvider:
    """No network, no key: a deterministic recap so the daily summary still works offline and
    in tests. The `user` message is already the rendered activity digest (see
    summary.render_activity), so presenting it back yields a faithful, un-prettified summary."""

    name = "offline"

    async def complete(self, system: str, user: str) -> str:
        body = user.strip() or "No tracked activity — a calm day."
        return f"Your day at a glance\n\n{body}"


def get_provider() -> ChatProvider:
    """Factory, and a FastAPI dependency. Engine order: CLI if configured, else HTTP if a key
    is configured, else the offline FallbackProvider. Override via
    `app.dependency_overrides[get_provider]` in tests."""
    settings = get_settings()
    if settings.ai_cli:
        return CliChatProvider(cli=settings.ai_cli, model=settings.ai_cli_model)
    if not settings.ai_api_key:
        return FallbackProvider()
    return HttpChatProvider(
        base_url=settings.ai_base_url,
        api_key=settings.ai_api_key,
        model=settings.ai_model,
    )
