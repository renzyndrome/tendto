"""Refuse to start in a configuration whose in-process state would be silently wrong.

Two subsystems keep state in the worker process rather than in a shared store:

- `app/ai/limits.py` — the spend and concurrency guards on `/ai/compose`. Sharded across N
  workers each one gets its own allowance, so the limit becomes N times what it says. This
  fails **open**: more money spent, and on the CLI engine more subprocesses forked.
- `app/routers/presence.py` — the in-memory poll registry. Sharded, viewers land in different
  workers and stop seeing each other. That one fails closed, which is merely wrong rather than
  expensive.

Neither is an oversight; both are documented decisions for a deployment with one worker and no
broker. What was missing is the thing that notices when that assumption stops being true, since
nothing about `--workers 4` announces that a rate limit has quietly quadrupled.

So this check refuses the boot rather than logging a warning nobody reads. The escape hatch is
one environment variable, so a deliberate multi-worker deployment is never actually blocked —
it just has to say it means it.
"""

import os
import sys

#: Set to "1" to start with several workers anyway, accepting the sharding above.
ALLOW_MULTIPLE_WORKERS_ENV = "TENDTO_ALLOW_MULTIPLE_WORKERS"


def _configured_workers(argv: list[str], environ: dict[str, str]) -> int:
    """How many workers this process was asked for: 1 when nothing says otherwise.

    Read from argv and the environment because a worker process has no other way to learn it —
    uvicorn does not expose its own worker count to the app it is serving.
    """
    for flag in ("--workers", "-w"):
        if flag in argv:
            index = argv.index(flag)
            if index + 1 < len(argv):
                try:
                    return int(argv[index + 1])
                except ValueError:
                    return 1
    for name in ("WEB_CONCURRENCY", "UVICORN_WORKERS", "GUNICORN_WORKERS"):
        raw = environ.get(name)
        if raw:
            try:
                return int(raw)
            except ValueError:
                continue
    return 1


def assert_single_worker(
    argv: list[str] | None = None, environ: dict[str, str] | None = None
) -> None:
    """Raise unless this process is the only one, or the operator has opted in."""
    argv = sys.argv if argv is None else argv
    environ = dict(os.environ) if environ is None else environ

    if environ.get(ALLOW_MULTIPLE_WORKERS_ENV) == "1":
        return
    workers = _configured_workers(argv, environ)
    if workers <= 1:
        return

    raise RuntimeError(
        f"Refusing to start with {workers} workers: the AI spend guards "
        "(app/ai/limits.py) and the presence registry (app/routers/presence.py) keep their "
        "state in the process. Across N workers each gets its own allowance, so the AI rate "
        f"limit silently becomes {workers}x what it says — it fails OPEN, and on the CLI engine "
        "that is forked subprocesses as well as money. Presence simply stops working between "
        f"workers. Move both to a shared store, or set {ALLOW_MULTIPLE_WORKERS_ENV}=1 to accept "
        "this."
    )
