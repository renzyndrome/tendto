"""Settings must load wherever the module lives — including inside the production image."""

from app.config import Settings


def test_settings_import_does_not_depend_on_a_repo_root() -> None:
    """The production image has no repo root above the app package.

    `config.py` resolves the dev `.env` by walking up from its own path. In the container the
    module sits at `/app/app/config.py`, which has fewer parents than that walk assumed, so the
    lookup raised `IndexError` at IMPORT time and the API container could never start at all —
    invisible in dev, fatal on the first deploy. This pins the guard.
    """
    from app.config import _CONFIG_FILE, _REPO_ROOT_ENV

    if len(_CONFIG_FILE.parents) > 3:
        assert _REPO_ROOT_ENV is not None
        assert _REPO_ROOT_ENV.name == ".env"
    else:
        assert _REPO_ROOT_ENV is None


def test_settings_construct_with_no_env_file() -> None:
    """Containers pass everything through real environment variables; no file is present."""
    settings = Settings(_env_file=None)
    assert settings.web_url
    assert settings.database_url
