"""AI endpoints (doc 06).

Only the daily summary lives here so far, and it is the *user-triggered* entry point to the
otherwise-ambient feature (the scheduled job in app/ai/jobs.py is the ambient half). Interactive
AI (per-page summarize, inline Ask AI) is deliberately not ambient — CLAUDE.md product guardrails.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.provider import ChatProvider, get_provider
from app.ai.summary import gather_activity, summarize
from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.schemas.ai import ActivityOut, DailySummaryRequest, DailySummaryResponse, DueItemOut

router = APIRouter(prefix="/ai", tags=["ai"])


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
