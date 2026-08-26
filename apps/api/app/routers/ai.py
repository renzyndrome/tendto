"""AI endpoints (doc 06).

Two tiers, and the split is the whole reason "more AI" does not mean "more clutter":

- AMBIENT: the daily summary. Runs by itself (the scheduled half lives in app/ai/jobs.py);
  `/daily-summary` here is its user-triggered entry point.
- INTERACTIVE: `/compose` — summarize a page, or rewrite a selection. Fires only when someone
  presses a button, on text they chose. Nothing here ever runs on its own.

`/status` exists so the editor can ask "is there an engine?" before offering any of it. With no
engine configured the interactive features are hidden outright rather than shown broken — unlike
the recap, which still has a real structured digest to fall back on.
"""

import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import NamedTuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.compose import TASKS, Task, clean, truncate, wrap_user_text
from app.ai.limits import gate, take
from app.ai.provider import ChatProvider, StreamingChatProvider, get_provider
from app.ai.summary import gather_activity, summarize
from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.schemas.ai import (
    ActivityOut,
    ComposeRequest,
    ComposeResponse,
    DailySummaryRequest,
    DailySummaryResponse,
    DueItemOut,
    EngineStatus,
    TaskOut,
)

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)


@router.post("/daily-summary", response_model=DailySummaryResponse)
async def daily_summary(
    body: DailySummaryRequest | None = None,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    provider: ChatProvider = Depends(get_provider),
) -> DailySummaryResponse:
    today = (body.today if body else None) or datetime.now(UTC).date()
    if body and (body.start or body.end):
        start, end = body.start, body.end or today  # start=None ⇒ everything so far
        if start is not None and start > end:
            raise HTTPException(status_code=422, detail="start must not be after end")
    else:
        day = (body.date if body else None) or today
        start = end = day

    activity = await gather_activity(session, user.id, start, end, today=today)
    summary = await summarize(activity, provider)
    return DailySummaryResponse(
        start=start,
        end=end,
        summary=summary,
        engine=getattr(provider, "name", "custom"),
        activity=ActivityOut(
            focus_minutes=activity.focus_minutes,
            focus_sessions=activity.focus_sessions,
            items_completed=list(activity.items_completed),
            items_created=list(activity.items_created),
            pages_updated=list(activity.pages_updated),
            items_overdue=[DueItemOut(title=d.title, due=d.due) for d in activity.items_overdue],
            items_due_next=[DueItemOut(title=d.title, due=d.due) for d in activity.items_due_next],
        ),
    )


@router.get("/status", response_model=EngineStatus)
async def status(
    user: CurrentUser = Depends(get_current_user),
    provider: ChatProvider = Depends(get_provider),
) -> EngineStatus:
    """Whether interactive AI can work here, and which tasks exist.

    Authenticated deliberately: which engine an instance runs is operator configuration, not
    something to tell the open internet.
    """
    engine = getattr(provider, "name", "custom")
    return EngineStatus(
        engine=engine,
        available=engine != "offline",
        tasks=[
            TaskOut(key=task.key, label=task.label, whole_document=task.whole_document)
            for task in TASKS.values()
        ],
    )


class _Prepared(NamedTuple):
    task: Task
    prompt: str
    engine: str
    truncated: bool


def _prepare(body: ComposeRequest, user: CurrentUser, provider: ChatProvider) -> _Prepared:
    """Validate, refuse an unusable engine, and spend one unit of the caller's allowance.

    Shared by both entry points so the streaming path cannot drift into being the cheap way
    round the guards.

    No workspace or membership check, and that is correct rather than an oversight: the text
    arrives in the request body from the caller's own editor. Nothing is read from the database
    and nothing is written, so there is no tenant boundary to cross here — the only thing being
    spent is inference, which is what the rate limit is for.
    """
    task = TASKS.get(body.task)
    if task is None:
        raise HTTPException(status_code=400, detail=f"Unknown task: {body.task}")

    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Nothing to work with")

    engine = getattr(provider, "name", "custom")
    if engine == "offline":
        # The fallback echoes its input, which would silently replace someone's paragraph with
        # itself. Refuse loudly instead; the client hides these features anyway (see /status).
        raise HTTPException(
            status_code=503,
            detail="No AI engine configured. Set AI_CLI or AI_API_KEY to use this.",
        )

    if not take(user.id):
        raise HTTPException(status_code=429, detail="Too many AI requests — try again shortly.")

    prompt, truncated = truncate(text)
    return _Prepared(task=task, prompt=wrap_user_text(prompt), engine=engine, truncated=truncated)


@router.post("/compose", response_model=ComposeResponse)
async def compose(
    body: ComposeRequest,
    user: CurrentUser = Depends(get_current_user),
    provider: ChatProvider = Depends(get_provider),
) -> ComposeResponse:
    """Run one curated task over the user's own text, and return the whole result.

    The streaming sibling below is what the editor uses; this stays as the plain, cacheable
    shape for anything that just wants an answer.
    """
    task, prompt, engine, truncated = _prepare(body, user, provider)
    try:
        # The gate bounds how many engine calls run at once. It matters most on the CLI engine,
        # where each call is a real subprocess with a two-minute timeout.
        async with gate():
            result = await provider.complete(task.system, prompt)
    except Exception as exc:  # any engine failure is one failure to the user
        # Deliberately generic: the CLI provider's message carries up to 500 chars of subprocess
        # stderr (host paths, config) and the HTTP provider's carries the upstream URL. Neither
        # belongs in a browser. The detail is still raised into the server log by `from exc`.
        logger.exception("AI compose failed (task=%s, engine=%s)", task.key, engine)
        raise HTTPException(status_code=502, detail="The AI engine failed.") from exc

    out = clean(result)
    if not out:
        raise HTTPException(status_code=502, detail="The AI engine returned nothing")
    return ComposeResponse(text=out, engine=engine, truncated=truncated)


@router.post("/compose/stream")
async def compose_stream(
    body: ComposeRequest,
    user: CurrentUser = Depends(get_current_user),
    provider: ChatProvider = Depends(get_provider),
) -> StreamingResponse:
    """The same task, delivered as it is written.

    Watching the words appear is most of what makes this feel usable — a rewrite that takes ten
    silent seconds feels broken even when it is working. Server-sent events over POST rather
    than `EventSource`, because EventSource cannot carry an Authorization header or a body; the
    client reads the response stream with fetch.

    Every provider is accepted here. One that cannot stream simply emits its whole answer as a
    single delta, so the client needs one code path instead of two.

    Errors after the first byte cannot be an HTTP status — the response has already started — so
    they arrive as a final `error` event and the client shows them like any other failure.
    """
    prepared = _prepare(body, user, provider)

    async def events() -> AsyncIterator[str]:
        def frame(payload: dict[str, object]) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        pieces: list[str] = []
        try:
            # The gate wraps the WHOLE stream, not just its start: on the CLI engine a live
            # stream is a live subprocess, and that is the thing being rationed.
            async with gate():
                if isinstance(provider, StreamingChatProvider):
                    async for piece in provider.stream(prepared.task.system, prepared.prompt):
                        pieces.append(piece)
                        yield frame({"delta": piece})
                else:
                    whole = await provider.complete(prepared.task.system, prepared.prompt)
                    pieces.append(whole)
                    yield frame({"delta": whole})
        except Exception as exc:
            logger.exception(
                "AI stream failed (task=%s, engine=%s)", prepared.task.key, prepared.engine
            )
            yield frame({"error": "The AI engine failed."})
            del exc
            return

        # `clean` runs over the assembled text, never the pieces: a code fence can straddle two
        # deltas, so stripping per-chunk would miss it.
        text = clean("".join(pieces))
        if not text:
            yield frame({"error": "The AI engine returned nothing."})
            return
        yield frame({"done": True, "text": text, "truncated": prepared.truncated})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # nginx buffers proxied responses by default, which would hold the whole stream
            # back until it finished and quietly undo the entire point of this endpoint.
            "X-Accel-Buffering": "no",
        },
    )
