"""Jogar pela internet: túnel (com cloudflared/tailscale falsos), código de acesso e aprovação de entrada."""

import asyncio
import json
import os
import socket
import stat
import sys
import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.core.config import Settings
from app.core.origin import client_key, is_remote
from app.main import create_app
from app.models import RoomJoinRequest
from app.server_cli import _check_internet_port, main
from app.services import remote as remote_module
from app.services.remote import RemoteAccess, cloudflared_asset, new_access_code, normalize_code
from tests.conftest import API, auth, quick_character, receive_until, register

QUICK_URL = "https://mesa-de-teste-abc.trycloudflare.com"


def _script(path, body: str) -> str:
    path.write_text(f"#!{sys.executable}\n{body}", encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return str(path)


@pytest.fixture
def fake_cloudflared(tmp_path) -> str:
    # Igual ao cloudflared de verdade: o link sai no stderr, dentro de uma moldura, e o programa fica rodando.
    return _script(
        tmp_path / "cloudflared",
        "import json, os, sys, time\n"
        "open(os.path.join(os.environ['HOME'], 'cloudflared-args.json'), 'w').write(json.dumps(sys.argv[1:]))\n"
        "print('2026-09-30T12:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...', file=sys.stderr)\n"
        f"print('2026-09-30T12:00:01Z INF |  {QUICK_URL}  |', file=sys.stderr, flush=True)\n"
        "time.sleep(3600)\n",
    )


@pytest.fixture
def internet_port():
    """Alguém atendendo na porta de internet (no servidor de verdade é o próprio uvicorn)."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen()
        yield sock.getsockname()[1]


@pytest.fixture
def net_settings(settings, fake_cloudflared, internet_port) -> Settings:
    return settings.model_copy(update={"internet_port": internet_port, "cloudflared_path": fake_cloudflared})


@pytest.fixture
def net(net_settings):
    with TestClient(create_app(net_settings)) as client:
        yield client, f"http://testserver:{net_settings.internet_port}"


def wait_status(client, admin, *wanted: str, timeout: float = 15) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        view = client.get(f"{API}/remote", headers=auth(admin)).json()
        if view["status"] in wanted:
            return view
        time.sleep(0.1)
    raise AssertionError(f"status {wanted} não chegou: {view}")


def turn_on(client, admin) -> dict:
    r = client.put(f"{API}/remote", json={"mode": "quick"}, headers=auth(admin))
    assert r.status_code == 200, r.text
    return wait_status(client, admin, "on")


# ---------- de onde vem ----------


def test_origin_by_port_and_tunnel_headers():
    settings = Settings(port=8080)
    lan = {"server": ("192.168.0.14", 8080), "client": ("192.168.0.20", 5000), "headers": []}
    tunnel = {"server": ("127.0.0.1", 8081), "client": ("127.0.0.1", 5000), "headers": []}
    assert not is_remote(lan, settings)
    assert is_remote(tunnel, settings)
    assert is_remote({**lan, "headers": [(b"Tailscale-Funnel-Request", b"?1")]}, settings)
    # IP público sozinho não conta (celular da casa com IPv6).
    assert not is_remote({**lan, "client": ("2804:14c::1", 5000)}, settings)
    # Pelo túnel, o IP de verdade vem da Cloudflare; na rede de casa o cabeçalho é ignorado.
    assert client_key({**tunnel, "headers": [(b"cf-connecting-ip", b"203.0.113.9")]}, settings) == "203.0.113.9"
    assert client_key({**lan, "headers": [(b"x-other", b"1")]}, settings) == "192.168.0.20"
    assert Settings(port=9000).remote_port == 9001
    assert Settings(port=9000, internet_port=9500).remote_port == 9500


def test_access_code_format_and_assets():
    code = new_access_code()
    assert len(code) == 9 and code[4] == "-"
    assert not set(code.replace("-", "")) & set("01IO")
    assert normalize_code(" abcd-efgh ") == "ABCDEFGH"
    assert cloudflared_asset("Linux", "x86_64") == "cloudflared-linux-amd64"
    assert cloudflared_asset("Linux", "aarch64") == "cloudflared-linux-arm64"
    assert cloudflared_asset("Linux", "armv7l") == "cloudflared-linux-arm"
    assert cloudflared_asset("Windows", "AMD64") == "cloudflared-windows-amd64.exe"
    with pytest.raises(RuntimeError):
        cloudflared_asset("Darwin", "arm64")


# ---------- túnel e painel ----------


def test_quick_tunnel_share_code_and_turn_off(net, net_settings):
    client, _ = net
    admin, player = register(client, "Dono"), register(client, "Ana")
    assert client.get(f"{API}/remote", headers=auth(player)).status_code == 403
    view = client.get(f"{API}/remote", headers=auth(admin)).json()
    assert view["mode"] == "off" and view["status"] == "off" and view["available"]
    assert view["internet_port"] == net_settings.internet_port

    view = turn_on(client, admin)
    assert view["url"] == QUICK_URL and view["error"] is None
    args = json.loads((net_settings.data_path / "cloudflared-args.json").read_text())
    assert args == ["tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{net_settings.internet_port}"]
    saved = json.loads((net_settings.data_path / "remote.json").read_text())
    assert saved["mode"] == "quick" and saved["current_url"] == QUICK_URL
    assert saved["access_code"] == view["access_code"]

    # Quem mestra uma mesa vê o link e o código; jogador sem mesa, não.
    assert client.get(f"{API}/remote/share", headers=auth(player)).status_code == 403
    client.post(f"{API}/rooms", json={"name": "Mesa", "ruleset_id": "srd-5.1"}, headers=auth(player))
    share = client.get(f"{API}/remote/share", headers=auth(player)).json()
    assert share == {"enabled": True, "status": "on", "url": QUICK_URL, "access_code": view["access_code"]}

    new = client.post(f"{API}/remote/code", headers=auth(admin)).json()
    assert new["access_code"] != view["access_code"]

    off = client.put(f"{API}/remote", json={"mode": "off"}, headers=auth(admin)).json()
    assert off["status"] == "off" and off["url"] is None
    assert client.get(f"{API}/remote/share", headers=auth(admin)).json()["enabled"] is False


def test_internet_restarts_with_server(net_settings):
    with TestClient(create_app(net_settings)) as client:
        turn_on(client, register(client, "Dono"))
    # Reabriu o servidor: o link rápido volta sozinho (e o código continua o mesmo).
    with TestClient(create_app(net_settings)) as client:
        remote = client.app.state.ctx.remote
        deadline = time.monotonic() + 15
        while remote.status != "on" and time.monotonic() < deadline:
            time.sleep(0.1)
        assert remote.status == "on" and remote.url == QUICK_URL


def test_internet_disabled_in_config(settings):
    with TestClient(create_app(settings.model_copy(update={"internet_enabled": False}))) as client:
        admin = register(client, "Dono")
        view = client.put(f"{API}/remote", json={"mode": "quick"}, headers=auth(admin)).json()
        assert view["status"] == "error" and not view["available"]
        assert "RPG_INTERNET_ENABLED" in view["error"]


def test_turning_on_asks_approval_in_open_rooms(net):
    client, _ = net
    admin = register(client, "Dono")
    before = client.post(f"{API}/rooms", json={"name": "Antes", "ruleset_id": "srd-5.1"}, headers=auth(admin)).json()
    assert before["require_approval"] is False
    turn_on(client, admin)
    assert client.get(f"{API}/rooms/{before['id']}", headers=auth(admin)).json()["require_approval"] is True
    after = client.post(f"{API}/rooms", json={"name": "Depois", "ruleset_id": "srd-5.1"}, headers=auth(admin)).json()
    assert after["require_approval"] is True
    # O Mestre ainda pode escolher na criação.
    free = client.post(
        f"{API}/rooms", json={"name": "Livre", "ruleset_id": "srd-5.1", "require_approval": False}, headers=auth(admin)
    ).json()
    assert free["require_approval"] is False


# ---------- cadastro pela internet ----------


def test_register_from_internet_needs_access_code(net):
    client, remote = net
    body = {"username": "longe", "password": "senha-secreta", "display_name": "De Longe"}

    # Sem ninguém cadastrado: o dono cria a conta em casa.
    r = client.post(f"{remote}{API}/auth/register", json={**body, "access_code": "x"})
    assert r.status_code == 403
    admin = register(client, "Dono")

    info = client.get(f"{remote}{API}/discovery").json()
    assert info["access_code_required"] and not info["registration_open"] and info["addresses"] == []
    assert client.get(f"{API}/discovery").json()["access_code_required"] is False

    r = client.post(f"{remote}{API}/auth/register", json=body)
    assert r.status_code == 403 and "desligado" in r.json()["detail"]

    code = turn_on(client, admin)["access_code"]
    info = client.get(f"{remote}{API}/discovery").json()
    assert info["registration_open"] and info["internet"]

    r = client.post(f"{remote}{API}/auth/register", json={**body, "access_code": "AAAA-AAAA"})
    assert r.status_code == 403 and r.json()["code"] == "access_code"
    # O código vale com letra minúscula e sem o traço (ditado por mensagem).
    r = client.post(f"{remote}{API}/auth/register", json={**body, "access_code": code.replace("-", "").lower()})
    assert r.status_code == 201, r.text
    # Na rede de casa continua sem código.
    register(client, "Vizinho")


def test_register_from_internet_is_rate_limited(net):
    client, remote = net
    turn_on(client, register(client, "Dono"))
    statuses = [
        client.post(
            f"{remote}{API}/auth/register",
            json={"username": f"u{i}xx", "password": "senha-secreta", "display_name": "Alguém", "access_code": "x"},
            headers={"cf-connecting-ip": "203.0.113.7"},
        ).status_code
        for i in range(12)
    ]
    assert statuses[:10] == [403] * 10 and statuses[10:] == [429, 429]
    # Outro IP não é afetado.
    other = client.post(
        f"{remote}{API}/auth/register",
        json={"username": "outro", "password": "senha-secreta", "display_name": "Outro", "access_code": "x"},
        headers={"cf-connecting-ip": "203.0.113.8"},
    )
    assert other.status_code == 403


def test_login_from_internet_limited_per_account(net):
    client, remote = net
    user = register(client, "Dono")
    statuses = [
        client.post(
            f"{remote}{API}/auth/login",
            json={"username": user["username"], "password": "errada"},
            headers={"cf-connecting-ip": f"203.0.113.{i}"},
        ).status_code
        for i in range(21)
    ]
    assert statuses[:20] == [401] * 20 and statuses[20] == 429


# ---------- aprovação de entrada ----------


def _approval_room(client):
    master, ana = register(client, "Mestre"), register(client, "Ana")
    room = client.post(
        f"{API}/rooms", json={"name": "Mesa", "ruleset_id": "srd-5.1", "require_approval": True}, headers=auth(master)
    ).json()
    assert room["require_approval"] is True
    return master, ana, room


def test_join_waits_for_master_and_is_approved(client):
    master, ana, room = _approval_room(client)
    hero = quick_character(client, ana, "srd-5.1", class_key="fighter", ancestry_key="human")

    with client.websocket_connect(f"/ws/rooms/{room['pin']}") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": master["token"]}))
        assert ws.receive_json()["type"] == "welcome"

        # Ana pede pela internet (porta de internet padrão = 8081).
        r = client.post(
            f"http://testserver:8081{API}/rooms/join",
            json={"pin": room["pin"].lower(), "character_id": hero["id"]},
            headers=auth(ana),
        )
        assert r.status_code == 409 and r.json()["code"] == "join_pending"
        msg = receive_until(ws, "join.requests")
        assert [(q["display_name"], q["character_name"], q["remote"]) for q in msg["requests"]] == [
            ("Ana", hero["name"], True)
        ]

    status = client.get(f"{API}/rooms/join-status", params={"pin": room["pin"]}, headers=auth(ana)).json()
    assert status == {"status": "pending", "room": None}
    # Ainda não é da mesa.
    assert client.get(f"{API}/rooms/{room['id']}", headers=auth(ana)).status_code == 403
    assert client.get(f"{API}/rooms/{room['id']}", headers=auth(master)).json()["pending_requests"] == 1

    # Só o Mestre vê e decide.
    assert client.get(f"{API}/rooms/{room['id']}/requests", headers=auth(ana)).status_code == 403
    requests = client.get(f"{API}/rooms/{room['id']}/requests", headers=auth(master)).json()
    ana_id = requests[0]["user_id"]
    assert client.post(f"{API}/rooms/{room['id']}/requests/{ana_id}/approve", headers=auth(ana)).status_code == 403

    view = client.post(f"{API}/rooms/{room['id']}/requests/{ana_id}/approve", headers=auth(master)).json()
    assert view["pending_requests"] == 0
    assert [(m["display_name"], (m["character"] or {}).get("name")) for m in view["members"]] == [
        ("Mestre", None),
        ("Ana", hero["name"]),
    ]
    status = client.get(f"{API}/rooms/join-status", params={"pin": room["pin"]}, headers=auth(ana)).json()
    assert status["status"] == "approved" and status["room"]["id"] == room["id"]
    assert status["room"]["pending_requests"] == 0 and status["room"]["my_role"] == "player"
    # Já é da mesa: entrar de novo não pede aprovação.
    assert client.post(f"{API}/rooms/join", json={"pin": room["pin"]}, headers=auth(ana)).status_code == 200
    assert client.post(f"{API}/rooms/{room['id']}/requests/{ana_id}/approve", headers=auth(master)).status_code == 404


def test_denied_player_waits_before_asking_again(client, settings):
    master, ana, room = _approval_room(client)
    assert client.post(f"{API}/rooms/join", json={"pin": room["pin"]}, headers=auth(ana)).status_code == 409
    ana_id = client.get(f"{API}/rooms/{room['id']}/requests", headers=auth(master)).json()[0]["user_id"]
    # Na rede de casa o pedido não vem marcado como da internet.
    assert client.get(f"{API}/rooms/{room['id']}/requests", headers=auth(master)).json()[0]["remote"] is False

    client.post(f"{API}/rooms/{room['id']}/requests/{ana_id}/deny", headers=auth(master))
    status = client.get(f"{API}/rooms/join-status", params={"pin": room["pin"]}, headers=auth(ana)).json()
    assert status["status"] == "denied"
    r = client.post(f"{API}/rooms/join", json={"pin": room["pin"]}, headers=auth(ana))
    assert r.status_code == 403 and r.json()["code"] == "join_denied"
    assert client.get(f"{API}/rooms/{room['id']}/requests", headers=auth(master)).json() == []

    # Passados 10 minutos, pode pedir de novo.
    async def age() -> None:
        async with client.app.state.ctx.db.sessionmaker() as session:
            await session.execute(update(RoomJoinRequest).values(updated_at=datetime.now(UTC) - timedelta(minutes=11)))
            await session.commit()

    client.portal.call(age)
    assert client.get(f"{API}/rooms/join-status", params={"pin": room["pin"]}, headers=auth(ana)).status_code == 404
    assert client.post(f"{API}/rooms/join", json={"pin": room["pin"]}, headers=auth(ana)).status_code == 409


def test_join_status_does_not_reveal_rooms(client):
    master, ana, room = _approval_room(client)
    for pin in (room["pin"], "ZZZZZZ"):
        r = client.get(f"{API}/rooms/join-status", params={"pin": pin}, headers=auth(ana))
        assert r.status_code == 404 and r.json()["detail"] == "Sala não encontrada. Confira o PIN."


def test_master_toggles_approval(client):
    master, ana, room = _approval_room(client)
    assert (
        client.patch(f"{API}/rooms/{room['id']}", json={"require_approval": False}, headers=auth(ana)).status_code
        == 403
    )
    view = client.patch(f"{API}/rooms/{room['id']}", json={"require_approval": False}, headers=auth(master)).json()
    assert view["require_approval"] is False
    assert client.post(f"{API}/rooms/join", json={"pin": room["pin"]}, headers=auth(ana)).status_code == 200


def test_full_room_refuses_before_asking(client):
    master = register(client, "Mestre")
    room = client.post(
        f"{API}/rooms",
        json={"name": "Mesa", "ruleset_id": "srd-5.1", "max_players": 1, "require_approval": True},
        headers=auth(master),
    ).json()
    ana, beto = register(client, "Ana"), register(client, "Beto")
    client.post(f"{API}/rooms/join", json={"pin": room["pin"]}, headers=auth(ana))
    client.post(f"{API}/rooms/join", json={"pin": room["pin"]}, headers=auth(beto))
    requests = client.get(f"{API}/rooms/{room['id']}/requests", headers=auth(master)).json()
    ok = client.post(f"{API}/rooms/{room['id']}/requests/{requests[0]['user_id']}/approve", headers=auth(master))
    assert ok.status_code == 200
    # Lotou: o segundo pedido não entra, e quem chega agora nem fica esperando.
    full = client.post(f"{API}/rooms/{room['id']}/requests/{requests[1]['user_id']}/approve", headers=auth(master))
    assert full.status_code == 409
    carla = register(client, "Carla")
    r = client.post(f"{API}/rooms/join", json={"pin": room["pin"]}, headers=auth(carla))
    assert r.status_code == 409 and r.json()["code"] == "conflict"


# ---------- programas do túnel ----------


REAL_ASYNC_CLIENT = httpx.AsyncClient


def _mock_httpx(monkeypatch, handler) -> None:  # noqa: ANN001
    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return REAL_ASYNC_CLIENT(*args, **kwargs)

    monkeypatch.setattr(remote_module.httpx, "AsyncClient", factory)


def test_cloudflared_is_downloaded_once(settings, monkeypatch):
    monkeypatch.setattr(remote_module.shutil, "which", lambda name: None)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, content=b"programa")

    _mock_httpx(monkeypatch, handler)
    remote = RemoteAccess(settings)
    path = asyncio.run(remote.ensure_cloudflared())
    assert calls == [f"{settings.cloudflared_download_url}/{cloudflared_asset()}"]
    assert open(path, "rb").read() == b"programa" and os.access(path, os.X_OK)
    assert asyncio.run(remote.ensure_cloudflared()) == path and len(calls) == 1


def test_cloudflared_download_failure_is_explained(settings, monkeypatch):
    monkeypatch.setattr(remote_module.shutil, "which", lambda name: None)
    _mock_httpx(monkeypatch, lambda request: httpx.Response(404))
    with pytest.raises(RuntimeError, match="Não consegui baixar"):
        asyncio.run(RemoteAccess(settings).ensure_cloudflared())
    assert not list((settings.data_path / "bin").iterdir())


@pytest.fixture
def fake_tailscale(tmp_path):
    status = tmp_path / "status.json"
    binary = _script(
        tmp_path / "tailscale",
        f"import sys\nassert sys.argv[1:] == ['status', '--json']\nprint(open({str(status)!r}).read())\n",
    )
    return binary, status


def test_fixed_link_is_checked(settings, fake_tailscale, monkeypatch):
    binary, status = fake_tailscale
    settings = settings.model_copy(update={"tailscale_path": binary})
    remote = RemoteAccess(settings, server_id="srv-1")
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json={"app": "rpgplay", "server_id": "srv-1"})

    _mock_httpx(monkeypatch, handler)

    status.write_text(json.dumps({"BackendState": "NeedsLogin", "Self": {}}))
    view = asyncio.run(remote.check_fixed())
    assert view["status"] == "error" and "conta do Tailscale" in view["error"]
    assert "rpgplay-server internet fixo" in view["error"]

    status.write_text(json.dumps({"BackendState": "Running", "Self": {"DNSName": "mesa.tail1234.ts.net."}}))
    view = asyncio.run(remote.check_fixed())
    assert view["status"] == "on" and view["url"] == "https://mesa.tail1234.ts.net"
    assert seen == ["https://mesa.tail1234.ts.net/api/v1/discovery"]
    assert json.loads(remote.path.read_text())["fixed_url"] == "https://mesa.tail1234.ts.net"

    # O nome responde, mas é outro servidor RPG Play.
    _mock_httpx(monkeypatch, lambda request: httpx.Response(200, json={"app": "rpgplay", "server_id": "outro"}))
    assert asyncio.run(remote.check_fixed())["status"] == "error"


def test_fixed_link_without_tailscale(settings, monkeypatch):
    monkeypatch.setattr(remote_module.shutil, "which", lambda name: None)
    view = asyncio.run(RemoteAccess(settings).check_fixed())
    assert view["status"] == "error" and "não está instalado" in view["error"]


# ---------- linha de comando ----------


def test_cli_internet_status(settings, monkeypatch, capsys):
    monkeypatch.setenv("RPG_DATA_DIR", str(settings.data_path))
    settings.data_path.mkdir(parents=True, exist_ok=True)
    (settings.data_path / "remote.json").write_text(
        json.dumps({"mode": "quick", "access_code": "ABCD-EFGH", "current_url": QUICK_URL})
    )
    from app.core.config import get_settings

    get_settings.cache_clear()
    try:
        assert main(["internet"]) == 0
    finally:
        get_settings.cache_clear()
    out = capsys.readouterr().out
    assert "link rápido" in out and QUICK_URL in out and "ABCD-EFGH" in out


def test_cli_internet_fixo_without_tailscale(settings, monkeypatch, capsys):
    monkeypatch.setenv("RPG_DATA_DIR", str(settings.data_path))
    monkeypatch.setattr(remote_module.shutil, "which", lambda name: None)
    from app.core.config import get_settings

    get_settings.cache_clear()
    try:
        assert main(["internet", "fixo"]) == 1
    finally:
        get_settings.cache_clear()
    assert "tailscale.com" in capsys.readouterr().out


def test_busy_internet_port_keeps_home_play(internet_port, capsys):
    settings = Settings(port=8080, internet_port=internet_port)
    assert _check_internet_port(settings).internet_enabled is False
    assert "ocupada" in capsys.readouterr().err
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        free = sock.getsockname()[1]
    assert _check_internet_port(Settings(port=8080, internet_port=free)).internet_enabled is True
    assert _check_internet_port(Settings(port=8080, internet_port=8080)).internet_enabled is False


def test_invite_page(client):
    r = client.get("/entrar?pin=ABC123&code=ABCD-EFGH")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    # A página não copia nada da URL para o HTML: o PIN e o código só entram pelo script (textContent).
    assert "ABC123" not in r.text and "rpgplay://join" in r.text and "releases/latest" in r.text
