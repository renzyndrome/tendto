"""Transactional email, provider-agnostic — same shape as app/ai/provider.py.

Features depend on the `EmailProvider` Protocol, never on a vendor. With no API key
configured, `ConsoleProvider` runs entirely offline: it logs the message and reports the send
as "not delivered", so the whole invite flow works in dev and in tests without credentials and
without the network. Set EMAIL_API_KEY (+ EMAIL_FROM) to send for real.

The caller decides what to do when delivery didn't happen — the invite endpoint returns the
invite URL so the UI can offer a copyable link (see routers/invitations.py).
"""

import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SendResult:
    """`delivered=False` is a normal outcome (no provider configured), not an error."""

    delivered: bool
    detail: str = ""


class EmailProvider(Protocol):
    async def send(self, *, to: str, subject: str, text: str) -> SendResult: ...


class ConsoleProvider:
    """No key, no network. Logs the mail so a dev can read the invite link from the API log."""

    async def send(self, *, to: str, subject: str, text: str) -> SendResult:
        logger.info("[email:console] to=%s subject=%s\n%s", to, subject, text)
        return SendResult(delivered=False, detail="No email provider configured")


class ResendProvider:
    """Resend's REST API (docs/planning 05 names Resend/Postmark for transactional mail)."""

    def __init__(self, *, api_key: str, sender: str, base_url: str, timeout: float = 10.0) -> None:
        self._api_key = api_key
        self._sender = sender
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def send(self, *, to: str, subject: str, text: str) -> SendResult:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    f"{self._base_url}/emails",
                    json={"from": self._sender, "to": [to], "subject": subject, "text": text},
                    headers={"Authorization": f"Bearer {self._api_key}"},
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            # A mail outage must not fail the invite — the row is already written and the
            # link still works. Report it so the UI can fall back to "copy link".
            logger.warning("Invite email to %s failed to send: %s", to, exc)
            return SendResult(delivered=False, detail="Email delivery failed")
        return SendResult(delivered=True)


def get_email_provider() -> EmailProvider:
    """Factory + FastAPI dependency. Override via `app.dependency_overrides` in tests."""
    settings = get_settings()
    if not settings.email_api_key:
        return ConsoleProvider()
    return ResendProvider(
        api_key=settings.email_api_key,
        sender=settings.email_from,
        base_url=settings.email_base_url,
    )
