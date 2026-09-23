import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-change-me-dev-only-change-me"


class Settings(BaseSettings):
    """Configuração lida de variáveis de ambiente com prefixo RPG_ (ex.: RPG_DATA_DIR).

    O padrão é o "modo casa": um processo só, SQLite e arquivos no diretório de dados.
    No servidor instalado pelo .deb as variáveis vêm de /etc/rpgplay/server.env.
    """

    model_config = SettingsConfigDict(env_prefix="RPG_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    server_name: str = "Mesa de RPG"
    host: str = "0.0.0.0"
    port: int = 8080
    # Tudo que precisa persistir (banco SQLite, mídia, segredo JWT, id do servidor) fica aqui.
    data_dir: str = "./data"

    # Vazio = SQLite em {data_dir}/rpgplay.db. Postgres continua suportado (postgresql+asyncpg://...).
    database_url: str | None = None
    # Cria as tabelas no startup (só testes). Fora disso o schema vem do Alembic (`rpgplay-server serve` migra).
    db_auto_create: bool = False
    # Só necessário com várias instâncias da API; em casa fica vazio (broadcaster em memória).
    redis_url: str | None = None

    # Vazio = gerado na primeira execução e guardado em {data_dir}/jwt_secret.
    jwt_secret: SecretStr | None = None
    jwt_access_ttl_minutes: int = 60
    jwt_refresh_ttl_days: int = 90

    allow_registration: bool = True
    # Descoberta na rede local (UDP broadcast). O app e o programa do Mestre perguntam "tem servidor aí?".
    discovery_enabled: bool = True
    discovery_port: int = 47777

    media_backend: Literal["local", "gcs"] = "local"
    media_local_dir: str | None = None
    gcs_bucket: str | None = None
    max_upload_bytes: int = 5 * 1024 * 1024
    max_map_upload_bytes: int = 20 * 1024 * 1024

    # Build do painel web do Mestre, servido em /mestre (o pacote .deb aponta para o dist embutido).
    web_dist_dir: str | None = None

    ws_auth_timeout_seconds: float = 5.0
    event_retention_days: int = 90
    account_purge_days: int = 30
    room_retention_days: int = 365

    @model_validator(mode="after")
    def _defaults(self) -> "Settings":
        if self.env in ("dev", "test") and self.jwt_secret is None:
            self.jwt_secret = SecretStr(DEV_JWT_SECRET)
        if self.env == "prod" and self.jwt_secret and self.jwt_secret.get_secret_value() == DEV_JWT_SECRET:
            raise ValueError("RPG_JWT_SECRET de desenvolvimento não pode ser usado em produção")
        if self.media_backend == "gcs" and not self.gcs_bucket:
            raise ValueError("RPG_GCS_BUCKET é obrigatório com media_backend=gcs")
        return self

    @property
    def data_path(self) -> Path:
        return Path(self.data_dir).expanduser().resolve()

    @property
    def sqlalchemy_url(self) -> str:
        return self.database_url or f"sqlite+aiosqlite:///{self.data_path / 'rpgplay.db'}"

    @property
    def media_path(self) -> Path:
        return Path(self.media_local_dir).expanduser().resolve() if self.media_local_dir else self.data_path / "media"


def _read_or_create(path: Path, factory) -> str:  # noqa: ANN001
    if path.exists():
        return path.read_text().strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    value = factory()
    path.write_text(value)
    path.chmod(0o600)
    return value


def ensure_runtime_secrets(settings: Settings) -> Settings:
    """Completa o segredo JWT com um valor persistido no diretório de dados (primeira execução)."""
    if settings.jwt_secret is not None:
        return settings
    secret = _read_or_create(settings.data_path / "jwt_secret", lambda: secrets.token_urlsafe(48))
    return settings.model_copy(update={"jwt_secret": SecretStr(secret)})


def server_id(settings: Settings) -> str:
    """Identificador estável do servidor (os clientes usam para não listar o mesmo servidor duas vezes)."""
    return _read_or_create(settings.data_path / "server_id", lambda: secrets.token_hex(8))


@lru_cache
def get_settings() -> Settings:
    return Settings()
