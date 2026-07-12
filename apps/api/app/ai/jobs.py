"""Ambient daily-summary job (doc 06 AI-1).

This is TendTo's ONLY ambient AI — every other AI action is user-triggered (CLAUDE.md product
guardrails). It is intentionally NOT wired to a scheduler here; see the TODO below.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import select

from app.ai.summary import build_daily_summary
from app.db import SessionLocal
from app.models.core import Membership

logger = logging.getLogger(__name__)


async def run_daily_summaries() -> None:
    """Once-daily ambient job: build (and eventually deliver) each user's daily summary.

    Delivery is a logged stub for now. A Phase-3 follow-up turns this into a real evening job.
    """
    day = datetime.now(UTC).date()
    async with SessionLocal() as session:
        user_ids = (await session.scalars(select(Membership.user_id).distinct())).all()
        for user_id in user_ids:
            summary = await build_daily_summary(session, user_id, day)
            # TODO(phase-3): scheduler (APScheduler/cron) + delivery (email/store as a note)
            logger.info(
                "daily summary ready for user %s (%d chars); delivery not yet wired",
                user_id,
                len(summary),
            )
