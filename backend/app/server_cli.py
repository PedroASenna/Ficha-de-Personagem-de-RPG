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
import sqlite3
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

from app.core import netcheck
from app.core.config import Settings, ensure_runtime_secrets, get_settings
from app.core.discovery import lan_addresses


def resource_root() -> Path:
    """Raiz dos arquivos do app (no executável do PyInstaller, a pasta extraída)."""
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))


def migrations_dir() -> Path:
    """Migrações do Alembic: "migrations" no executável (evita colidir com o pacote alembic), "alembic" no código."""
    bundled = resource_root() / "migrations"
    return bundled if bundled.exists() else resource_root() / "alembic"


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
    cfg.set_main_option("script_location", str(migrations_dir()))
    cfg.attributes["settings"] = settings
    settings.data_path.mkdir(parents=True, exist_ok=True)
    command.upgrade(cfg, "head")


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


def _sqlite_file(settings: Settings) -> Path | None:
    if not settings.sqlalchemy_url.startswith("sqlite"):
        print("Backup e restauração automáticos só com SQLite. Com Postgres, use pg_dump.", file=sys.stderr)
        return None
    return Path(settings.sqlalchemy_url.split("///", 1)[1])


def cmd_backup(args: argparse.Namespace) -> int:
    """Banco (cópia consistente, mesmo com o servidor rodando) + imagens num .tar.gz. "-" escreve na saída padrão."""
    settings = load_settings()
    db_file = _sqlite_file(settings)
    if db_file is None:
        return 1
    to_stdout = args.output == "-"
    with tempfile.TemporaryDirectory() as tmp:
        snapshot = Path(tmp) / "rpgplay.db"
        source = sqlite3.connect(db_file)
        target = sqlite3.connect(snapshot)
        with target:
            source.backup(target)
        source.close()
        target.close()
        if to_stdout:
            tar = tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz")
        else:
            tar = tarfile.open(Path(args.output).expanduser().resolve(), "w:gz")
        with tar:
            tar.add(snapshot, arcname="rpgplay.db")
            if settings.media_path.exists():
                tar.add(settings.media_path, arcname="media")
    if not to_stdout:
        print(f"Backup salvo em {Path(args.output).expanduser().resolve()}")
    return 0


def cmd_restore(args: argparse.Namespace) -> int:
    """Volta um backup. O servidor precisa estar parado; os dados atuais ficam guardados em antes-da-restauracao-*."""
    settings = load_settings()
    db_file = _sqlite_file(settings)
    if db_file is None:
        return 1
    data = settings.data_path
    data.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=data, prefix=".restaurando-") as tmp:
        staging = Path(tmp)
        if args.input == "-":
            tar = tarfile.open(fileobj=sys.stdin.buffer, mode="r|gz")
        else:
            tar = tarfile.open(Path(args.input).expanduser(), "r:gz")
        try:
            with tar:
                # filter="data" recusa caminhos absolutos, "..", links e arquivos especiais.
                tar.extractall(staging, filter="data")
        except (tarfile.FilterError, tarfile.ReadError) as exc:
            print(f"Backup recusado: arquivo inválido ou inseguro ({exc}).", file=sys.stderr)
            return 1
        new_db = staging / "rpgplay.db"
        if not new_db.is_file() or new_db.read_bytes()[:16] != b"SQLite format 3\x00":
            print("Arquivo inválido: não encontrei o banco rpgplay.db dentro do backup.", file=sys.stderr)
            return 1
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        previous = data / f"antes-da-restauracao-{stamp}"
        previous.mkdir()
        for suffix in ("", "-wal", "-shm"):
            current = db_file.with_name(db_file.name + suffix)
            if current.exists():
                current.rename(previous / current.name)
        if settings.media_path.exists():
            settings.media_path.rename(previous / "media")
        new_db.rename(db_file)
        if (staging / "media").is_dir():
            (staging / "media").rename(settings.media_path)
    migrate(settings)
    print(f"Backup restaurado. Os dados anteriores ficaram em {previous}")
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


def _home_network() -> tuple[Settings, list[tuple[int, str]], list[str], list]:
    """Configuração, portas a liberar e as redes da casa (sem criar arquivos: roda como root)."""
    settings = get_settings()
    checks = [(settings.port, "tcp")]
    if settings.discovery_enabled:
        checks.append((settings.discovery_port, "udp"))
    addresses = lan_addresses()
    code, ip_json = netcheck.run_command(["ip", "-j", "-4", "addr"])
    networks = netcheck.home_networks(addresses, ip_json if code == 0 else None)
    return settings, checks, addresses, networks


def _is_root() -> bool:
    return hasattr(os, "geteuid") and os.geteuid() == 0


def cmd_diagnostico(args: argparse.Namespace) -> int:
    """Por que o celular não conecta? Confere servidor, endereço e firewall e diz o que fazer."""
    settings, checks, addresses, networks = _home_network()
    port = settings.port
    problems = 0
    print("Diagnóstico do RPG Play")

    local = netcheck.probe(f"http://127.0.0.1:{port}")
    if local:
        print(f"  ✔ Servidor respondendo na porta {port} ({local.get('name')}, v{local.get('version')})")
    else:
        problems += 1
        print(f"  ✘ Nada respondendo em http://127.0.0.1:{port}: o servidor está parado.")
        print("      → sudo systemctl restart rpgplay-server   (erros: journalctl -u rpgplay-server -n 50)")

    if not addresses:
        problems += 1
        print("  ✘ Este computador não está numa rede local (Wi-Fi ou cabo desconectado?).")
    for address, network in zip(addresses, networks, strict=False):
        print(f"  ✔ Endereço para os celulares: http://{address}:{port}  (rede {network})")

    if not _is_root():
        print("  ! Rode com sudo para conferir o firewall: sudo rpgplay-server diagnostico")
    else:
        report = netcheck.detect_firewall(netcheck.run_command, checks)
        if not report.active:
            print("  ✔ Nenhum firewall (ufw ou firewalld) ativo")
        else:
            blocked = False
            for check_port, proto in checks:
                label = "celulares e painel" if proto == "tcp" else "descoberta automática"
                for network in networks:
                    if not report.allows(check_port, proto, network):
                        blocked = True
                        print(
                            f"  ✘ Firewall {report.name}: porta {check_port}/{proto} ({label}) bloqueada para {network}"
                        )
                    elif report.state(check_port, proto).open_to_anyone and not report.default_allows_incoming:
                        print(
                            f"  ! Firewall {report.name}: porta {check_port}/{proto} liberada para qualquer origem."
                            " Com IPv6 público, isso pode expor o servidor na internet; prefira só a rede de casa."
                        )
                    else:
                        print(
                            f"  ✔ Firewall {report.name}: porta {check_port}/{proto} ({label}) liberada para {network}"
                        )
            if blocked:
                problems += 1
                print("      → sudo rpgplay-server liberar-firewall   (libera só para a rede de casa)")

    if addresses:
        print(f"\nTeste no celular (no mesmo Wi-Fi): abra http://{addresses[0]}:{port}/api/v1/discovery no navegador.")
    if problems == 0:
        print(
            "Deste lado está tudo certo. Se o celular não abrir o endereço: confira se ele está no mesmo Wi-Fi"
            " (não na rede de convidados), sem VPN e sem dados móveis, e se o roteador não isola os aparelhos"
            ' ("isolamento de clientes" / "AP isolation").'
        )
    return 0 if problems == 0 else 1


def cmd_liberar_firewall(args: argparse.Namespace) -> int:
    """Libera as portas do RPG Play no ufw ou firewalld, só para a rede de casa."""
    if not _is_root():
        print("Rode com sudo: sudo rpgplay-server liberar-firewall", file=sys.stderr)
        return 1
    _, checks, _, networks = _home_network()
    if not networks:
        print("Este computador não está numa rede local: não há rede para liberar.", file=sys.stderr)
        return 1
    report = netcheck.detect_firewall(netcheck.run_command, checks)
    if not report.active:
        print("Nenhum firewall ativo (ufw ou firewalld): não há o que liberar.")
        return 0
    commands = netcheck.firewall_commands(report, networks, checks)
    if not commands:
        print(f"As portas já estão liberadas no {report.name} para a rede de casa.")
        return 0
    for command in commands:
        print(f"  $ {netcheck.shell_join(command)}")
        code, output = netcheck.run_command(command)
        if code != 0:
            print(output.strip(), file=sys.stderr)
            print("Não consegui liberar. Rode o comando acima à mão para ver o erro.", file=sys.stderr)
            return 1
    nets = ", ".join(str(n) for n in networks)
    print(f"Pronto: portas liberadas no {report.name} só para a rede de casa ({nets}).")
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
    backup.add_argument("output", help='arquivo de saída ("-" = saída padrão)')
    restore = sub.add_parser("restore", help="volta um backup (com o servidor parado)")
    restore.add_argument("input", help='arquivo .tar.gz ("-" = entrada padrão)')
    sub.add_parser("purge", help="aplica a retenção de dados")
    sub.add_parser("info", help="mostra os endereços para conectar")
    sub.add_parser("diagnostico", help="por que o celular não conecta? (servidor, endereço, firewall)")
    sub.add_parser("liberar-firewall", help="libera as portas no ufw/firewalld só para a rede de casa")
    args = parser.parse_args(argv)
    handlers = {
        "serve": cmd_serve,
        "reset-password": cmd_reset_password,
        "make-admin": cmd_make_admin,
        "backup": cmd_backup,
        "restore": cmd_restore,
        "purge": cmd_purge,
        "info": cmd_info,
        "diagnostico": cmd_diagnostico,
        "liberar-firewall": cmd_liberar_firewall,
        None: cmd_serve,
    }
    if args.command is None:
        args.port = None
    return handlers[args.command](args)


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    sys.exit(main())
