"""Spend limits for the interactive AI endpoint.

`/ai/compose` is the first endpoint in the app that costs real money — and on the CLI engine it
forks a process per call, so an unbounded loop is a fork bomb on the API host rather than merely
a bill. Both guards live here.

In-process state, which is correct for the deployment as it stands (one uvicorn worker, no
broker — the same assumption `presence` documents) and wrong the moment anyone adds
`--workers N`: each worker would then have its own allowance. That is a real limitation, not an
oversight; a shared limiter needs the backplane the hosting story deliberately does not have
yet. Note that unlike presence, a sharded limiter here fails OPEN (more spend allowed), so it
is worth revisiting before this is exposed to strangers.
"""

import asyncio
import time
from collections import defaultdict, deque

#: Calls one user may make in the rolling window below. Generous for a person clicking buttons,
#: nowhere near enough for a script.
MAX_CALLS = 20
WINDOW_SECONDS = 60.0

#: Requests allowed to be in flight at once, across everyone. The CLI engine spawns a real
#: subprocess per call with a 120s timeout, so this is the guard that keeps a burst from
#: exhausting the host rather than just the budget.
MAX_CONCURRENT = 4

_calls: dict[str, deque[float]] = defaultdict(deque)
_gate = asyncio.Semaphore(MAX_CONCURRENT)


def take(user_id: str, *, now: float | None = None) -> bool:
    """Record a call for this user. False when they are over their allowance."""
    stamp = time.monotonic() if now is None else now
    seen = _calls[user_id]
    while seen and stamp - seen[0] > WINDOW_SECONDS:
        seen.popleft()
    if len(seen) >= MAX_CALLS:
        return False
    seen.append(stamp)
    return True


def gate() -> asyncio.Semaphore:
    """The concurrency gate. A dependency-free accessor so tests can inspect it."""
    return _gate


def reset() -> None:
    """Forget all counters — for tests only."""
    _calls.clear()
