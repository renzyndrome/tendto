"""The multi-worker guard. See app/startup_checks.py for why it refuses rather than warns."""

import pytest

from app.startup_checks import ALLOW_MULTIPLE_WORKERS_ENV, assert_single_worker


def test_a_single_worker_is_the_normal_case():
    assert_single_worker(argv=["uvicorn", "app.main:app", "--port", "8000"], environ={})


@pytest.mark.parametrize(
    "argv,environ",
    [
        (["uvicorn", "app.main:app", "--workers", "4"], {}),
        (["uvicorn", "app.main:app", "-w", "2"], {}),
        (["uvicorn", "app.main:app"], {"WEB_CONCURRENCY": "8"}),
        (["gunicorn", "app.main:app"], {"GUNICORN_WORKERS": "3"}),
    ],
)
def test_several_workers_stop_the_boot(argv, environ):
    with pytest.raises(RuntimeError) as caught:
        assert_single_worker(argv=argv, environ=environ)
    # The message has to say what actually goes wrong, or it just looks like a bug in the guard.
    assert "fails OPEN" in str(caught.value)


def test_the_operator_can_opt_in():
    assert_single_worker(
        argv=["uvicorn", "app.main:app", "--workers", "4"],
        environ={ALLOW_MULTIPLE_WORKERS_ENV: "1"},
    )


def test_a_junk_worker_count_does_not_break_the_boot():
    """A guard that crashes on a value it cannot parse is worse than the problem it guards."""
    assert_single_worker(argv=["uvicorn", "app.main:app", "--workers", "many"], environ={})
    assert_single_worker(argv=["uvicorn", "app.main:app"], environ={"WEB_CONCURRENCY": "lots"})
