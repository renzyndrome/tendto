# TendTo API — FastAPI (authoritative write path)
FROM python:3.12-slim

WORKDIR /app

# Install deps first for layer caching (pyproject declares them; app code changes more often)
COPY pyproject.toml ./
COPY app ./app
# alembic.ini is REQUIRED in the image: the documented deploy step runs
# `docker compose run --rm api alembic upgrade head`, and without this file alembic exits with
# "No 'script_location' key found in configuration" — so production would come up with the
# better-auth tables but none of the application ones. The migrations themselves live under
# app/migrations, which the line above already copies.
COPY alembic.ini ./
RUN pip install --no-cache-dir .

# Alembic migrations run as a deploy step, not at container start:
#   docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
