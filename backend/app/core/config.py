from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-change-me-dev-only-change-me"


class Settings(BaseSettings):
    """Configuração lida de variáveis de ambiente com prefixo RPG_ (ex.: RPG_DATABASE_URL)."""

    model_config = SettingsConfigDict(env_prefix="RPG_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    database_url: str = "postgresql+asyncpg://rpg:rpg@localhost:5432/rpg"
    # Cria as tabelas no startup (só dev/test). Em produção o schema vem do Alembic.
    db_auto_create: bool = False
    # Com Redis configurado, os eventos de WebSocket são distribuídos entre instâncias (Cloud Run).
    redis_url: str | None = None

    jwt_secret: SecretStr = SecretStr(DEV_JWT_SECRET)
    jwt_access_ttl_minutes: int = 15
    jwt_refresh_ttl_days: int = 30

    media_backend: Literal["local", "gcs"] = "local"
    media_local_dir: str = "./media"
    gcs_bucket: str | None = None
    max_upload_bytes: int = 5 * 1024 * 1024

    terms_version: str = "2026-09"
    privacy_version: str = "2026-09"

    ws_auth_timeout_seconds: float = 5.0
    event_retention_days: int = 90
    account_purge_days: int = 30

    @model_validator(mode="after")
    def _check_production(self) -> "Settings":
        if self.env == "prod":
            if self.jwt_secret.get_secret_value() == DEV_JWT_SECRET:
                raise ValueError("RPG_JWT_SECRET precisa ser definido em produção")
            if self.db_auto_create:
                raise ValueError("RPG_DB_AUTO_CREATE não pode ser usado em produção; use o Alembic")
            if self.media_backend == "gcs" and not self.gcs_bucket:
                raise ValueError("RPG_GCS_BUCKET é obrigatório com media_backend=gcs")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
