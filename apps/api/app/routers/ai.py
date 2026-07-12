"""AI endpoints (doc 06).

Only the daily summary lives here so far, and it is the *user-triggered* entry point to the
otherwise-ambient feature (the scheduled job in app/ai/jobs.py is the ambient half). Interactive
AI (per-page summarize, inline Ask AI) is deliberately not ambient — CLAUDE.md product guardrails.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.provider import ChatProvider, get_provider
from app.ai.summary import build_daily_summary
from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.schemas.ai import DailySummaryRequest, DailySummaryResponse

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/daily-summary", response_model=DailySummaryResponse)
async def daily_summary(
    body: DailySummaryRequest | None = None,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    provider: ChatProvider = Depends(get_provider),
) -> DailySummaryResponse:
    day = body.date if body and body.date else datetime.now(UTC).date()
    summary = await build_daily_summary(session, user.id, day, provider=provider)
    return DailySummaryResponse(date=day, summary=summary)
