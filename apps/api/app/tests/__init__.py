"""Test package init — runs BEFORE conftest's imports, which is the point.

The suite must stay offline and deterministic no matter what the developer's .env says: with
AI_CLI set, every endpoint test that doesn't override `get_provider` would shell out to a real
AI CLI — slow, billable, and nondeterministic. Environment variables take precedence over the
env_file in pydantic-settings, and this module is imported before any app module can call
`get_settings()` (conftest imports app.db, which builds its engine at import time).
"""

import os

os.environ["AI_CLI"] = ""
os.environ["AI_API_KEY"] = ""
