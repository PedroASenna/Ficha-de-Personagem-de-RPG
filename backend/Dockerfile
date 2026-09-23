# Stage 1: instala dependências num venv isolado
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml ./
COPY app ./app
RUN pip install ".[gcp]"

# Stage 2: imagem final enxuta, sem compiladores, rodando como usuário não-root
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH" PORT=8080
WORKDIR /app

RUN useradd --create-home --uid 10001 app && mkdir -p /home/app/media && chown app:app /home/app/media
COPY --from=builder /opt/venv /opt/venv
COPY --chown=app:app alembic.ini ./
COPY --chown=app:app alembic ./alembic
COPY --chown=app:app app ./app

USER app
EXPOSE 8080

# Cloud Run injeta $PORT. As migrações rodam num Cloud Run Job separado (ver docs/DEPLOY_GCP.md).
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
