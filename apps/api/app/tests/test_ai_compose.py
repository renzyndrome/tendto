"""POST /ai/compose and GET /ai/status — the interactive AI tier.

The behaviour worth pinning is what happens at the edges: an unknown task, an engine that
fails, an engine that isn't configured at all, and a model that ignores "return only the text".
The happy path is one line; the edges are where a user's paragraph could get replaced with
something wrong.
"""

from typing import Any

import pytest
from httpx import AsyncClient

from app.ai.compose import MAX_INPUT_CHARS, TASKS, USER_TEXT_MARKER, clean, truncate
from app.ai import limits
from app.ai.provider import get_provider
from app.main import app


class FakeProvider:
    """Records what it was asked, answers what it was told to."""

    def __init__(self, reply: str = "a shorter thing", name: str = "api") -> None:
        self.name = name
        self.reply = reply
        self.system: str | None = None
        self.user: str | None = None

    async def complete(self, system: str, user: str) -> str:
        self.system, self.user = system, user
        return self.reply


class BrokenProvider:
    name = "api"

    async def complete(self, system: str, user: str) -> str:
        raise RuntimeError("upstream exploded")


def _use(provider: Any) -> None:
    app.dependency_overrides[get_provider] = lambda: provider


@pytest.fixture(autouse=True)
def _restore_provider():
    # The rate limiter is process-global, so one test's calls would otherwise count against
    # the next one's allowance.
    limits.reset()
    yield
    app.dependency_overrides.pop(get_provider, None)
    limits.reset()


# --- the happy path ---------------------------------------------------------------------


async def test_compose_returns_the_engines_text(client: AsyncClient) -> None:
    provider = FakeProvider(reply="Tighter copy.")
    _use(provider)

    res = await client.post("/ai/compose", json={"task": "shorten", "text": "  a long ramble  "})

    assert res.status_code == 200
    assert res.json() == {"text": "Tighter copy.", "engine": "api", "truncated": False}
    # The task's instructions ride the system slot, which outranks the user slot, and the
    # user's text is fenced behind a marker the system prompt disowns as instructions.
    assert provider.system == TASKS["shorten"].system
    assert provider.user == f"{USER_TEXT_MARKER}\na long ramble"


async def test_every_advertised_task_runs(client: AsyncClient) -> None:
    """/status advertises these keys, so every one of them must be accepted by /compose."""
    _use(FakeProvider(reply="ok"))

    for key in TASKS:
        res = await client.post("/ai/compose", json={"task": key, "text": "some text"})
        assert res.status_code == 200, key


# --- the edges --------------------------------------------------------------------------


async def test_unknown_task_is_rejected(client: AsyncClient) -> None:
    _use(FakeProvider())

    res = await client.post("/ai/compose", json={"task": "make_it_rhyme", "text": "hi"})

    assert res.status_code == 400


async def test_empty_text_is_rejected(client: AsyncClient) -> None:
    _use(FakeProvider())

    res = await client.post("/ai/compose", json={"task": "fix", "text": "   \n  "})

    assert res.status_code == 422


async def test_offline_engine_refuses_rather_than_echoing(client: AsyncClient) -> None:
    """The fallback provider returns its input. Pasting that back would replace someone's
    paragraph with itself and call it an improvement."""
    _use(FakeProvider(name="offline"))

    res = await client.post("/ai/compose", json={"task": "improve", "text": "my paragraph"})

    assert res.status_code == 503
    assert "AI_CLI" in res.json()["detail"]


async def test_engine_failure_becomes_a_502(client: AsyncClient) -> None:
    _use(BrokenProvider())

    res = await client.post("/ai/compose", json={"task": "fix", "text": "teh cat"})

    assert res.status_code == 502


async def test_empty_engine_output_becomes_a_502(client: AsyncClient) -> None:
    """Better a visible failure than silently blanking the user's selection."""
    _use(FakeProvider(reply="   "))

    res = await client.post("/ai/compose", json={"task": "fix", "text": "teh cat"})

    assert res.status_code == 502


async def test_a_fenced_reply_is_unwrapped(client: AsyncClient) -> None:
    """Models add code fences despite being told not to, and a stray ``` lands in a document."""
    _use(FakeProvider(reply="```markdown\n- one\n- two\n```"))

    res = await client.post("/ai/compose", json={"task": "summarize", "text": "notes"})

    assert res.json()["text"] == "- one\n- two"


async def test_very_long_input_is_clipped_and_says_so(client: AsyncClient) -> None:
    provider = FakeProvider(reply="short")
    _use(provider)

    res = await client.post(
        "/ai/compose", json={"task": "summarize", "text": "word " * (MAX_INPUT_CHARS // 2)}
    )

    assert res.status_code == 200
    assert res.json()["truncated"] is True
    assert provider.user is not None
    # The clip applies to the user's text; the marker prefix is ours and rides on top.
    assert len(provider.user) <= MAX_INPUT_CHARS + len(USER_TEXT_MARKER) + 1


# --- status -----------------------------------------------------------------------------


async def test_status_reports_a_working_engine_and_its_tasks(client: AsyncClient) -> None:
    _use(FakeProvider(name="claude-cli"))

    body = (await client.get("/ai/status")).json()

    assert body["engine"] == "claude-cli"
    assert body["available"] is True
    assert [task["key"] for task in body["tasks"]] == list(TASKS)
    # Exactly one whole-document task today (summarize); the rest act on a selection.
    assert [task["key"] for task in body["tasks"] if task["whole_document"]] == ["summarize"]


async def test_status_reports_unavailable_when_offline(client: AsyncClient) -> None:
    """The client hides the AI entry points on this, rather than showing dead buttons."""
    _use(FakeProvider(name="offline"))

    body = (await client.get("/ai/status")).json()

    assert body["engine"] == "offline"
    assert body["available"] is False


# --- pure helpers -----------------------------------------------------------------------


def test_truncate_keeps_short_text_untouched() -> None:
    assert truncate("hello") == ("hello", False)


def test_truncate_breaks_on_a_word_boundary() -> None:
    text, was_clipped = truncate("word " * (MAX_INPUT_CHARS // 2))
    assert was_clipped is True
    assert not text.endswith("wor")  # never hands the model half a word


def test_clean_leaves_ordinary_text_alone() -> None:
    assert clean("  Just a sentence.  ") == "Just a sentence."


# --- spend guards -----------------------------------------------------------------------


async def test_a_user_is_rate_limited(client: AsyncClient) -> None:
    """The first endpoint that costs real money per call, and on the CLI engine forks a
    process per call — an unbounded loop is a fork bomb, not merely a bill."""
    _use(FakeProvider(reply="ok"))
    body = {"task": "fix", "text": "some text"}

    for _ in range(limits.MAX_CALLS):
        assert (await client.post("/ai/compose", json=body)).status_code == 200

    over = await client.post("/ai/compose", json=body)
    assert over.status_code == 429


async def test_an_absurd_body_is_rejected_before_the_engine(client: AsyncClient) -> None:
    """A hard request cap belongs at the proxy; this stops the obvious case."""
    provider = FakeProvider()
    _use(provider)

    res = await client.post("/ai/compose", json={"task": "fix", "text": "x" * 200_001})

    assert res.status_code == 422
    assert provider.user is None  # never reached the engine


async def test_engine_internals_do_not_reach_the_client(client: AsyncClient) -> None:
    """The CLI provider's message carries subprocess stderr (host paths, config) and the HTTP
    provider's carries the upstream URL. Neither belongs in a browser."""
    _use(BrokenProvider())

    res = await client.post("/ai/compose", json={"task": "fix", "text": "teh cat"})

    assert res.status_code == 502
    assert res.json()["detail"] == "The AI engine failed."
    assert "upstream exploded" not in res.text


def test_the_limiter_forgets_old_calls() -> None:
    limits.reset()
    for index in range(limits.MAX_CALLS):
        assert limits.take("someone", now=float(index)) is True
    assert limits.take("someone", now=float(limits.MAX_CALLS)) is False
    # ...and the window rolls.
    assert limits.take("someone", now=limits.WINDOW_SECONDS + 10) is True


def test_the_limiter_is_per_user() -> None:
    limits.reset()
    for index in range(limits.MAX_CALLS):
        limits.take("noisy", now=float(index))
    assert limits.take("quiet", now=0.0) is True
