"""POST /ai/compose/stream — the same tasks, delivered as they are written.

What matters here is not that streaming works (that is the provider's job) but that the
streaming path cannot become the cheap way around the guards: the same validation, the same
refusal on an unusable engine, and the same rate limit. Plus the two things unique to a
stream — a provider that cannot stream must still work, and a failure after the first byte
cannot be an HTTP status.
"""

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import AsyncClient

from app.ai import limits
from app.ai.provider import StreamingChatProvider, get_provider
from app.main import app


class StreamingFake:
    """Emits its reply piece by piece, as a real engine does."""

    name = "api"

    def __init__(self, pieces: list[str]) -> None:
        self.pieces = pieces
        self.system: str | None = None

    async def complete(self, system: str, user: str) -> str:
        return "".join(self.pieces)

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:
        self.system = system
        for piece in self.pieces:
            yield piece


class NonStreamingFake:
    """A provider with no `stream` — the offline-ish shape, or an unverified CLI."""

    name = "api"

    async def complete(self, system: str, user: str) -> str:
        return "all at once"


class ExplodingStream:
    name = "api"

    async def complete(self, system: str, user: str) -> str:
        return "unused"

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:
        yield "partial "
        raise RuntimeError("the engine died mid-sentence")


def _use(provider: Any) -> None:
    app.dependency_overrides[get_provider] = lambda: provider


@pytest.fixture(autouse=True)
def _clean():
    limits.reset()
    yield
    app.dependency_overrides.pop(get_provider, None)
    limits.reset()


def _events(body: str) -> list[dict[str, Any]]:
    """Parse an SSE body into its JSON payloads."""
    return [
        json.loads(line[len("data:") :].strip())
        for line in body.splitlines()
        if line.startswith("data:")
    ]


async def test_pieces_arrive_then_a_final_done(client: AsyncClient) -> None:
    _use(StreamingFake(["Hello", " there", "!"]))

    res = await client.post("/ai/compose/stream", json={"task": "improve", "text": "hi"})

    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    events = _events(res.text)
    assert [e["delta"] for e in events if "delta" in e] == ["Hello", " there", "!"]
    assert events[-1] == {"done": True, "text": "Hello there!", "truncated": False}


async def test_a_provider_that_cannot_stream_still_works(client: AsyncClient) -> None:
    """One code path on the client: a non-streaming engine sends its answer as one delta."""
    _use(NonStreamingFake())
    assert not isinstance(NonStreamingFake(), StreamingChatProvider)

    res = await client.post("/ai/compose/stream", json={"task": "fix", "text": "hi"})

    events = _events(res.text)
    assert [e["delta"] for e in events if "delta" in e] == ["all at once"]
    assert events[-1]["text"] == "all at once"


async def test_a_fence_split_across_deltas_is_still_stripped(client: AsyncClient) -> None:
    """`clean` runs over the assembled text: a code fence can straddle two chunks, so
    stripping per-chunk would miss it and leave ``` in someone's document."""
    _use(StreamingFake(["```", "markdown\nhello\n", "```"]))

    res = await client.post("/ai/compose/stream", json={"task": "summarize", "text": "x"})

    assert _events(res.text)[-1]["text"] == "hello"


async def test_a_failure_mid_stream_arrives_as_an_event(client: AsyncClient) -> None:
    """The response has already started, so it cannot become a 502 — the status is long gone."""
    _use(ExplodingStream())

    res = await client.post("/ai/compose/stream", json={"task": "fix", "text": "hi"})

    assert res.status_code == 200  # headers were sent before anything went wrong
    events = _events(res.text)
    assert events[0] == {"delta": "partial "}
    assert events[-1] == {"error": "The AI engine failed."}
    # And the engine's own words never reach the browser.
    assert "died mid-sentence" not in res.text


async def test_an_empty_stream_is_reported(client: AsyncClient) -> None:
    _use(StreamingFake([]))

    res = await client.post("/ai/compose/stream", json={"task": "fix", "text": "hi"})

    assert _events(res.text)[-1] == {"error": "The AI engine returned nothing."}


# --- the guards apply here too ----------------------------------------------------------


async def test_streaming_refuses_an_unknown_task(client: AsyncClient) -> None:
    _use(StreamingFake(["x"]))

    res = await client.post("/ai/compose/stream", json={"task": "nope", "text": "hi"})

    assert res.status_code == 400


async def test_streaming_refuses_the_offline_engine(client: AsyncClient) -> None:
    provider = StreamingFake(["x"])
    provider.name = "offline"
    _use(provider)

    res = await client.post("/ai/compose/stream", json={"task": "fix", "text": "hi"})

    assert res.status_code == 503


async def test_streaming_shares_the_rate_limit(client: AsyncClient) -> None:
    """Otherwise the stream would be the cheap way around the spend guard."""
    _use(StreamingFake(["x"]))
    body = {"task": "fix", "text": "hi"}

    for _ in range(limits.MAX_CALLS):
        assert (await client.post("/ai/compose/stream", json=body)).status_code == 200

    assert (await client.post("/ai/compose/stream", json=body)).status_code == 429
    # ...and it is one shared allowance, not one per endpoint.
    assert (await client.post("/ai/compose", json=body)).status_code == 429


async def test_ask_streams_like_any_other_task(client: AsyncClient) -> None:
    """The answer arrives over the same channel; only the prompt shape differs."""
    provider = StreamingFake(["You said ", "Friday [1]."])
    _use(provider)

    res = await client.post(
        "/ai/compose/stream",
        json={
            "task": "ask",
            "text": "[1] Launch plan\nShip on Friday.",
            "question": "When do we ship?",
        },
    )

    assert res.status_code == 200
    events = _events(res.text)
    assert [e["delta"] for e in events if "delta" in e] == ["You said ", "Friday [1]."]
    assert events[-1] == {"done": True, "text": "You said Friday [1].", "truncated": False}


async def test_streaming_ask_still_needs_a_question(client: AsyncClient) -> None:
    """The guard lives in the shared _prepare, so the stream cannot slip past it."""
    _use(StreamingFake(["x"]))

    res = await client.post("/ai/compose/stream", json={"task": "ask", "text": "[1] Notes"})

    assert res.status_code == 422
