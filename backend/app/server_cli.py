"""rpgplay-server: o servidor RPG Play da casa.

    rpgplay-server serve                     # migra o banco e sobe o servidor (é o que o systemd roda)
    rpgplay-server info                      # endereços para conectar os celulares e o PC do Mestre
    rpgplay-server reset-password USUARIO    # sem e-mail de recuperação: o dono do servidor redefine
    rpgplay-server make-admin USUARIO
    rpgplay-server backup ARQUIVO.tar.gz     # banco SQLite + imagens (mapas, retratos)
    rpgplay-server purge                     # retenção (log antigo, contas excluídas, campanhas abandonadas)

Configuração: variáveis RPG_* (no pacote .deb, em /etc/rpgplay/server.env).
"""

import argparse
import asyncio
import os
import secrets
import socket
import sqlite3
import sys
import tarfile
import tempfile
from pathlib import Path

from app.core.config import Settings, ensure_runtime_secrets, get_settings


def resource_root() -> Path:
    """Raiz dos arquivos do app (no executável do PyInstaller, a pasta extraída)."""
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))


def load_settings() -> Settings:
    settings = ensure_runtime_secrets(get_settings())
    bundled_web = resource_root() / "web_dist"
    if settings.web_dist_dir is None and (bundled_web / "index.html").exists():
        settings = settings.model_copy(update={"web_dist_dir": str(bundled_web)})
    return settings


def migrate(settings: Settings) -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config()
    cfg.set_main_option("script_location", str(resource_root() / "alembic"))
    cfg.attributes["settings"] = settings
    settings.data_path.mkdir(parents=True, exist_ok=True)
    command.upgrade(cfg, "head")


def lan_addresses() -> list[str]:
    """IPs desta máquina na rede local (para mostrar "conecte em http://IP:porta")."""
    found: list[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # não envia nada; só descobre a interface de saída
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(str(info[4][0]))
    except OSError:
        pass
    return [ip for ip in dict.fromkeys(found) if not ip.startswith("127.")]


def _print_info(settings: Settings) -> None:
    print(f"RPG Play: {settings.server_name}")
    print(f"  dados:  {settings.data_path}")
    for ip in lan_addresses() or ["<ip-desta-maquina>"]:
        print(f"  jogadores (app):   http://{ip}:{settings.port}")
        print(f"  Mestre (navegador): http://{ip}:{settings.port}/mestre")


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from app.main import create_app

    settings = load_settings()
    if args.port:
        settings = settings.model_copy(update={"port": args.port})
    migrate(settings)
    _print_info(settings)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="info")
    return 0


async def _with_session(settings: Settings, fn):  # noqa: ANN001
    from app.db.session import Database

    db = Database(settings.sqlalchemy_url)
    try:
        async with db.sessionmaker() as session:
            return await fn(session)
    finally:
        await db.dispose()


def cmd_reset_password(args: argparse.Namespace) -> int:
    from sqlalchemy import delete, select

    from app.core.security import hash_password
    from app.models import RefreshToken, User

    settings = load_settings()
    migrate(settings)
    password = args.password or secrets.token_urlsafe(8)

    async def run(session) -> bool:  # noqa: ANN001
        user = await session.scalar(select(User).where(User.username == args.username.lower()))
        if user is None or user.deleted_at is not None:
            return False
        user.password_hash = hash_password(password)
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id))
        await session.commit()
        return True

    if not asyncio.run(_with_session(settings, run)):
        print(f"Usuário '{args.username}' não encontrado.", file=sys.stderr)
        return 1
    print(f"Senha de '{args.username}' redefinida." + ("" if args.password else f" Nova senha: {password}"))
    return 0


def cmd_make_admin(args: argparse.Namespace) -> int:
    from sqlalchemy import select

    from app.models import User

    settings = load_settings()
    migrate(settings)

    async def run(session) -> bool:  # noqa: ANN001
        user = await session.scalar(select(User).where(User.username == args.username.lower()))
        if user is None:
            return False
        user.is_admin = True
        await session.commit()
        return True

    ok = asyncio.run(_with_session(settings, run))
    print(f"'{args.username}' agora é admin." if ok else f"Usuário '{args.username}' não encontrado.")
    return 0 if ok else 1


def cmd_backup(args: argparse.Namespace) -> int:
    settings = load_settings()
    if not settings.sqlalchemy_url.startswith("sqlite"):
        print("Backup automático só para SQLite. Com Postgres, use pg_dump.", file=sys.stderr)
        return 1
    db_file = Path(settings.sqlalchemy_url.split("///", 1)[1])
    output = Path(args.output).expanduser().resolve()
    with tempfile.TemporaryDirectory() as tmp:
        snapshot = Path(tmp) / "rpgplay.db"
        # API de backup do SQLite: cópia consistente mesmo com o servidor rodando.
        source = sqlite3.connect(db_file)
        target = sqlite3.connect(snapshot)
        with target:
            source.backup(target)
        source.close()
        target.close()
        with tarfile.open(output, "w:gz") as tar:
            tar.add(snapshot, arcname="rpgplay.db")
            if settings.media_path.exists():
                tar.add(settings.media_path, arcname="media")
    print(f"Backup salvo em {output}")
    return 0


def cmd_purge(args: argparse.Namespace) -> int:
    from app.services.account import purge
    from app.services.media import build_media_store

    settings = load_settings()
    migrate(settings)
    result = asyncio.run(_with_session(settings, lambda s: purge(s, settings, build_media_store(settings))))
    print(f"Expurgo concluído: {result}")
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    _print_info(load_settings())
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rpgplay-server", description="Servidor RPG Play da casa")
    sub = parser.add_subparsers(dest="command")
    serve = sub.add_parser("serve", help="migra o banco e sobe o servidor")
    serve.add_argument("--port", type=int, default=None)
    reset = sub.add_parser("reset-password", help="redefine a senha de um usuário")
    reset.add_argument("username")
    reset.add_argument("--password", default=None, help="sem isso, gera uma senha aleatória")
    admin = sub.add_parser("make-admin", help="torna um usuário admin")
    admin.add_argument("username")
    backup = sub.add_parser("backup", help="gera um .tar.gz com banco e imagens")
    backup.add_argument("output")
    sub.add_parser("purge", help="aplica a retenção de dados")
    sub.add_parser("info", help="mostra os endereços para conectar")
    args = parser.parse_args(argv)
    handlers = {
        "serve": cmd_serve,
        "reset-password": cmd_reset_password,
        "make-admin": cmd_make_admin,
        "backup": cmd_backup,
        "purge": cmd_purge,
        "info": cmd_info,
        None: cmd_serve,
    }
    if args.command is None:
        args.port = None
    return handlers[args.command](args)


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    sys.exit(main())
