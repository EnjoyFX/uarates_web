# --- build stage: ставимо залежності через uv ---
FROM python:3.12-alpine AS builder

COPY --from=ghcr.io/astral-sh/uv:0.7.8 /uv /bin/

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# --- runtime stage: лише Python, venv і код ---
FROM python:3.12-alpine

WORKDIR /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY --from=builder /app/.venv /app/.venv
COPY app.py .
COPY templates templates
COPY static static

EXPOSE 5555

# Продакшен-сервер замість вбудованого dev-сервера Flask
CMD ["gunicorn", "--bind", "0.0.0.0:5555", "--workers", "2", "--threads", "4", "--timeout", "60", "--access-logfile", "-", "app:app"]
