"""Schemas for the AI endpoints (doc 06)."""

import datetime

from pydantic import BaseModel

# NB: the JSON field is called `date`, which shadows `datetime.date` inside the class body, so
# annotations reference the type via the module (`datetime.date`) rather than a bare `date`.


class DailySummaryRequest(BaseModel):
    """Optional body for POST /ai/daily-summary. Omit (or send null) for today (UTC)."""

    date: datetime.date | None = None


class DailySummaryResponse(BaseModel):
    date: datetime.date
    summary: str
