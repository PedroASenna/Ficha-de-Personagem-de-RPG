"""Servidor no Windows: pasta de dados, servidor.env, regra do firewall e diagnóstico (simulado no Linux)."""

import socket
from pathlib import Path

import pytest

from app import server_cli
from app.core import netcheck, winhost


def test_pasta_de_dados_e_servidor_env(tmp_path):
    environ = {"PROGRAMDATA": str(tmp_path)}
    data = winhost.default_data_dir(environ)
    assert data == tmp_path / "RPG Play" / "servidor"
    data.mkdir(parents=True)
    (data / "servidor.env").write_text(
        '\ufeff# comentário\nRPG_SERVER_NAME="Mesa do Pedro"\nRPG_PORT = 9090\n\nlinha sem igual\nRPG_ENV=dev\n',
        encoding="utf-8",
    )
    assert winhost.apply_defaults(environ) == data
    assert environ["RPG_SERVER_NAME"] == "Mesa do Pedro" and environ["RPG_PORT"] == "9090"
    assert environ["RPG_DATA_DIR"] == str(data) and environ["RPG_ENV"] == "dev"
    # O que já veio do ambiente vale mais que o arquivo; sem arquivo, produção por padrão.
    assert winhost.apply_defaults({"PROGRAMDATA": str(tmp_path), "RPG_PORT": "7000"}) == data
    fresh = {"PROGRAMDATA": str(tmp_path / "vazio")}
    winhost.apply_defaults(fresh)
    assert fresh["RPG_ENV"] == "prod"


def test_regra_do_firewall_so_para_a_rede_local():
    delete, add = winhost.firewall_commands(Path(r"C:\Program Files\RPG Play Servidor\rpgplay-server.exe"))
    assert delete == ["netsh", "advfirewall", "firewall", "delete", "rule", "name=RPG Play Servidor"]
    assert "remoteip=localsubnet" in add and "dir=in" in add and "action=allow" in add
    assert r"program=C:\Program Files\RPG Play Servidor\rpgplay-server.exe" in add


def test_url_do_sqlite_com_barras_normais(tmp_path):
    from app.core.config import Settings

    url = Settings(data_dir=str(tmp_path / "com espaço")).sqlalchemy_url
    assert url.startswith("sqlite+aiosqlite:///") and "\\" not in url and url.endswith("com espaço/rpgplay.db")


class FakeWindows:
    def __init__(self, rule: bool):
        self.rule = rule
        self.calls: list[list[str]] = []

    def run(self, args):
        self.calls.append(args)
        if args[:4] == ["netsh", "advfirewall", "firewall", "show"]:
            return (0, "Rule Name: RPG Play Servidor") if self.rule else (1, "No rules match the specified criteria.")
        if args[:4] == ["netsh", "advfirewall", "firewall", "add"]:
            self.rule = True
            return 0, "Ok."
        if args[:4] == ["netsh", "advfirewall", "firewall", "delete"]:
            self.rule = False
            return 0, "Ok."
        return 127, ""


@pytest.fixture
def windows(monkeypatch):
    fake = FakeWindows(rule=False)
    monkeypatch.setattr(server_cli, "IS_WINDOWS", True)
    monkeypatch.setattr(netcheck, "run_command", fake.run)
    monkeypatch.setattr(server_cli, "lan_addresses", lambda: ["192.168.0.20"])
    monkeypatch.setattr(
        netcheck, "probe", lambda url, timeout=2.0: {"app": "rpgplay", "name": "PC", "version": "0.3.1"}
    )
    server_cli.get_settings.cache_clear()
    yield fake
    server_cli.get_settings.cache_clear()


def test_diagnostico_e_liberar_firewall_no_windows(windows, monkeypatch, capsys):
    assert server_cli.main(["diagnostico"]) == 1
    out = capsys.readouterr().out
    assert "Diagnóstico do RPG Play (Windows)" in out and "http://192.168.0.20:8080" in out
    assert 'falta a regra "RPG Play Servidor"' in out and "Liberar no firewall" in out
    assert "sudo" not in out

    monkeypatch.setattr(winhost, "is_admin", lambda: False)
    assert server_cli.main(["liberar-firewall"]) == 1
    assert "administrador" in capsys.readouterr().err

    monkeypatch.setattr(winhost, "is_admin", lambda: True)
    assert server_cli.main(["liberar-firewall"]) == 0
    assert "criada no Firewall do Windows" in capsys.readouterr().out
    added = next(c for c in windows.calls if c[3] == "add")
    assert "remoteip=localsubnet" in added

    assert server_cli.main(["diagnostico"]) == 0
    assert "✔ Firewall do Windows" in capsys.readouterr().out


def test_porta_ocupada_avisa_em_vez_de_travar(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("RPG_DATA_DIR", str(tmp_path))
    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        port = busy.getsockname()[1]
        assert not server_cli.port_available("127.0.0.1", port)
        monkeypatch.setenv("RPG_HOST", "127.0.0.1")
        server_cli.get_settings.cache_clear()
        try:
            assert server_cli.main(["serve", "--port", str(port)]) == 1
        finally:
            server_cli.get_settings.cache_clear()
    assert f"A porta {port} já está em uso" in capsys.readouterr().err
    assert server_cli.port_available("127.0.0.1", port)
