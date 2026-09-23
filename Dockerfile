# Servidor RPG Play em container: alternativa ao pacote .deb (mesmo servidor, SQLite em /data).
#   docker compose up -d --build
# Contexto: raiz do repositório (o painel do Mestre é compilado aqui dentro).

FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.12-slim AS deps
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /src
COPY backend/pyproject.toml ./
COPY backend/app ./app
# Só as dependências ficam no venv; o código roda de /app (onde também estão as migrações).
RUN pip install . && pip uninstall -y rpg-play-api

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH" \
    RPG_ENV=prod RPG_DATA_DIR=/data RPG_WEB_DIST_DIR=/app/web_dist
WORKDIR /app
RUN useradd --create-home --uid 10001 rpgplay && mkdir -p /data && chown rpgplay:rpgplay /data
COPY --from=deps /opt/venv /opt/venv
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY --from=web /web/dist ./web_dist
USER rpgplay
VOLUME ["/data"]
EXPOSE 8080/tcp 47777/udp
HEALTHCHECK --interval=30s --timeout=5s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)"
ENTRYPOINT ["python", "-m", "app.server_cli"]
CMD ["serve"]
