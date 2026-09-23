"""Servidor da casa: descoberta na rede, campanhas persistentes e comandos do rpgplay-server."""

import asyncio
import json
import socket
import tarfile

from app.core.discovery import MAGIC, start_discovery
from app.server_cli import main as server_cli
from tests.conftest import auth, register

API = "/api/v1"


def test_http_discovery(client):
    info = client.get(f"{API}/discovery").json()
    assert info["app"] == "rpgplay" and info["name"] == "Mesa de Teste"
    assert info["master_path"] == "/mestre" and info["port"] == 8080
    assert len(info["server_id"]) == 16
    assert all(not ip.startswith("127.") for ip in info["addresses"])
    # O id é estável (guardado no diretório de dados).
    assert client.get(f"{API}/discovery").json()["server_id"] == info["server_id"]


def test_udp_discovery_responder():
    async def scenario():
        transport = await start_discovery(0, lambda: {"app": "rpgplay", "name": "Casa", "port": 8080}, "127.0.0.1")
        assert transport is not None
        port = transport.get_extra_info("sockname")[1]
        loop = asyncio.get_running_loop()
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.setblocking(False)
            sock.sendto(b"lixo", ("127.0.0.1", port))
            sock.sendto(MAGIC + b"?", ("127.0.0.1", port))
            data = await asyncio.wait_for(loop.sock_recv(sock, 2048), timeout=2)
        transport.close()
        return json.loads(data)

    reply = asyncio.run(scenario())
    assert reply == {"app": "rpgplay", "name": "Casa", "port": 8080}


def test_master_panel_served_with_spa_fallback(settings, tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>painel</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    with TestClient(create_app(settings.model_copy(update={"web_dist_dir": str(dist)}))) as c:
        assert c.get("/", follow_redirects=False).headers["location"] == "/mestre/"
        assert c.get("/mestre/").text == "<html>painel</html>"
        assert c.get("/mestre/mesa/123").text == "<html>painel</html>"  # rota do cliente
        assert c.get("/mestre/assets/app.js").text == "console.log(1)"
        # Tentativa de sair da pasta do painel devolve o index, nunca arquivos do sistema.
        escaped = c.get("/mestre/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd")
        assert "root:" not in escaped.text


def test_campaign_archive_and_reopen(client):
    master = register(client, "Mestre")
    room = client.post(f"{API}/rooms", json={"name": "Campanha", "ruleset_id": "srd-5.1"}, headers=auth(master)).json()
    assert client.post(f"{API}/rooms/{room['id']}/close", headers=auth(master)).status_code == 204
    assert client.get(f"{API}/rooms", headers=auth(master)).json() == []
    archived = client.get(f"{API}/rooms?include_archived=true", headers=auth(master)).json()
    assert [r["status"] for r in archived] == ["closed"]

    other = register(client, "Outro")
    assert client.post(f"{API}/rooms/{room['id']}/reopen", headers=auth(other)).status_code == 403
    reopened = client.post(f"{API}/rooms/{room['id']}/reopen", headers=auth(master)).json()
    assert reopened["status"] == "open" and reopened["pin"] == room["pin"]
    assert client.post(f"{API}/rooms/join", json={"pin": room["pin"]}, headers=auth(other)).status_code == 200


def test_reopen_gets_new_pin_when_old_one_is_taken(client, monkeypatch):
    from app.services import rooms as room_service

    master = register(client, "Mestre")
    first = client.post(f"{API}/rooms", json={"name": "A", "ruleset_id": "srd-5.1"}, headers=auth(master)).json()
    client.post(f"{API}/rooms/{first['id']}/close", headers=auth(master))
    pins = iter([first["pin"], "ZZZZZ2", "ZZZZZ3"])
    monkeypatch.setattr(room_service, "new_pin", lambda: next(pins))
    second = client.post(f"{API}/rooms", json={"name": "B", "ruleset_id": "srd-5.1"}, headers=auth(master)).json()
    assert second["pin"] == first["pin"]
    reopened = client.post(f"{API}/rooms/{first['id']}/reopen", headers=auth(master)).json()
    assert reopened["pin"] == "ZZZZZ2"


def test_cli_reset_password_backup_and_purge(tmp_path, monkeypatch, capsys):
    from fastapi.testclient import TestClient

    from app.core.config import Settings, get_settings
    from app.main import create_app

    data_dir = tmp_path / "casa"
    # Instalação padrão: SQLite no diretório de dados, mesmo que o ambiente (CI) aponte para um Postgres.
    for var in ("RPG_DATABASE_URL", "RPG_REDIS_URL", "RPG_JWT_SECRET"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("RPG_DATA_DIR", str(data_dir))
    monkeypatch.setenv("RPG_ENV", "prod")
    monkeypatch.setenv("RPG_DISCOVERY_ENABLED", "false")
    get_settings.cache_clear()
    try:
        assert server_cli(["info"]) == 0
        # O "serve" migra o banco; aqui migramos pelo reset-password (que também migra) e subimos o app.
        assert server_cli(["reset-password", "ninguem"]) == 1
        settings = Settings()
        from app.server_cli import load_settings

        with TestClient(create_app(load_settings())) as c:
            register(c, "Dono", "dono")
        # Segredo JWT gerado e persistido com permissão restrita.
        secret_file = data_dir / "jwt_secret"
        assert secret_file.exists() and oct(secret_file.stat().st_mode & 0o777) == "0o600"

        assert server_cli(["reset-password", "dono", "--password", "senha-nova-123"]) == 0
        with TestClient(create_app(load_settings())) as c:
            ok = c.post(f"{API}/auth/login", json={"username": "dono", "password": "senha-nova-123"})
            assert ok.status_code == 200

        backup = tmp_path / "backup.tar.gz"
        assert server_cli(["backup", str(backup)]) == 0
        with tarfile.open(backup) as tar:
            assert "rpgplay.db" in tar.getnames()
        assert server_cli(["purge"]) == 0
        assert "Expurgo concluído" in capsys.readouterr().out
        assert settings.sqlalchemy_url.startswith("sqlite")
    finally:
        get_settings.cache_clear()
