# TendTo API — FastAPI (authoritative write path)
FROM python:3.12-slim

WORKDIR /app

# Install deps first for layer caching (pyproject declares them; app code changes more often)
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

# Alembic migrations run as a deploy step, not at container start:
#   docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
