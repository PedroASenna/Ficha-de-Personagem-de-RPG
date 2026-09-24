"""Diagnóstico de rede: firewall (ufw / firewalld), redes da casa e os comandos diagnostico / liberar-firewall."""

import ipaddress
import json

import pytest

from app import server_cli
from app.core import netcheck

CHECKS = [(8080, "tcp"), (47777, "udp")]
CASA = ipaddress.ip_network("192.168.0.0/24")

UFW_BLOQUEANDO = """Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
22/tcp (v6)                ALLOW IN    Anywhere (v6)
"""

UFW_LIBERADO_CASA = UFW_BLOQUEANDO + """8080/tcp                   ALLOW IN    192.168.0.0/24
47777/udp                  ALLOW IN    192.168.0.0/24
"""

UFW_ABERTO_GERAL = UFW_BLOQUEANDO + """8080/tcp                   ALLOW IN    Anywhere
8080/tcp (v6)              ALLOW IN    Anywhere (v6)
"""

FIREWALLD_PADRAO = """public (active)
  target: default
  icmp-block-inversion: no
  interfaces: wlp2s0
  sources:
  services: dhcpv6-client mdns ssh
  ports:
  protocols:
  forward: yes
  masquerade: no
  rich rules:
"""

IP_JSON = json.dumps(
    [
        {"ifname": "lo", "addr_info": [{"family": "inet", "local": "127.0.0.1", "prefixlen": 8}]},
        {"ifname": "wlp2s0", "addr_info": [{"family": "inet", "local": "192.168.0.14", "prefixlen": 24}]},
        {"ifname": "lxcbr0", "addr_info": [{"family": "inet", "local": "10.0.3.1", "prefixlen": 24}]},
        {"ifname": "eth9", "addr_info": [{"family": "inet", "local": "169.254.3.3", "prefixlen": 16}]},
    ]
)


def test_redes_da_casa_vem_do_ip_ou_supoe_24():
    assert netcheck.parse_ip_addr_json(IP_JSON) == [
        ipaddress.ip_network("192.168.0.0/24"),
        ipaddress.ip_network("10.0.3.0/24"),
    ]
    # Só a interface que os celulares usam (a da rota padrão), não pontes de contêiner.
    assert netcheck.home_networks(["192.168.0.14"], IP_JSON) == [CASA]
    assert netcheck.home_networks(["10.1.2.3"], None) == [ipaddress.ip_network("10.1.2.0/24")]
    assert netcheck.parse_ip_addr_json("lixo") == []


def test_ufw_ativo_sem_regra_bloqueia():
    report = netcheck.parse_ufw(UFW_BLOQUEANDO, CHECKS)
    assert report.active and not report.default_allows_incoming
    assert not report.allows(8080, "tcp", CASA)
    assert not report.allows(47777, "udp", CASA)


def test_ufw_com_regra_da_rede_de_casa_libera():
    report = netcheck.parse_ufw(UFW_LIBERADO_CASA, CHECKS)
    assert report.allows(8080, "tcp", CASA)
    assert report.allows(47777, "udp", CASA)
    assert not report.state(8080, "tcp").open_to_anyone
    # Outra rede continua bloqueada.
    assert not report.allows(8080, "tcp", ipaddress.ip_network("10.0.0.0/24"))


def test_ufw_aberto_para_qualquer_origem_e_detectado():
    report = netcheck.parse_ufw(UFW_ABERTO_GERAL, CHECKS)
    assert report.allows(8080, "tcp", CASA)
    assert report.state(8080, "tcp").open_to_anyone


@pytest.mark.parametrize(
    "rule",
    [
        "8000:9000/tcp              ALLOW IN    Anywhere",
        "8080                       ALLOW IN    192.168.0.0/16",
        "Anywhere                   ALLOW IN    192.168.0.0/24",
        "80,443,8080/tcp            ALLOW IN    192.168.0.0/24",
    ],
)
def test_ufw_formatos_de_regra_que_liberam(rule):
    assert netcheck.parse_ufw(UFW_BLOQUEANDO + rule + "\n", CHECKS).allows(8080, "tcp", CASA)


def test_ufw_inativo_ou_padrao_allow_nao_bloqueia():
    assert netcheck.parse_ufw("Status: inactive\n", CHECKS).allows(8080, "tcp", CASA)
    permissivo = UFW_BLOQUEANDO.replace("Default: deny (incoming)", "Default: allow (incoming)")
    assert netcheck.parse_ufw(permissivo, CHECKS).allows(8080, "tcp", CASA)


def test_firewalld():
    report = netcheck.parse_firewalld("running\n", FIREWALLD_PADRAO, CHECKS)
    assert report.active and not report.allows(8080, "tcp", CASA)
    com_porta = FIREWALLD_PADRAO.replace("  ports:\n", "  ports: 8080/tcp 47777/udp\n")
    assert netcheck.parse_firewalld("running", com_porta, CHECKS).allows(47777, "udp", CASA)
    rich = (
        FIREWALLD_PADRAO
        + '\trule family="ipv4" source address="192.168.0.0/24" port port="8080" protocol="tcp" accept\n'
    )
    assert netcheck.parse_firewalld("running", rich, CHECKS).allows(8080, "tcp", CASA)
    assert not netcheck.parse_firewalld("not running", FIREWALLD_PADRAO, CHECKS).active


def test_comandos_liberam_so_a_rede_de_casa():
    ufw = netcheck.parse_ufw(UFW_BLOQUEANDO, CHECKS)
    assert netcheck.firewall_commands(ufw, [CASA], CHECKS) == [
        ["ufw", "allow", "from", "192.168.0.0/24", "to", "any", "port", "8080", "proto", "tcp"],
        ["ufw", "allow", "from", "192.168.0.0/24", "to", "any", "port", "47777", "proto", "udp"],
    ]
    assert netcheck.firewall_commands(netcheck.parse_ufw(UFW_LIBERADO_CASA, CHECKS), [CASA], CHECKS) == []
    firewalld = netcheck.parse_firewalld("running", FIREWALLD_PADRAO, CHECKS)
    commands = netcheck.firewall_commands(firewalld, [CASA], CHECKS)
    assert commands[0] == [
        "firewall-cmd",
        "--permanent",
        '--add-rich-rule=rule family="ipv4" source address="192.168.0.0/24" port port="8080" protocol="tcp" accept',
    ]
    assert commands[-1] == ["firewall-cmd", "--reload"]


class FakeSystem:
    """Simula os comandos do sistema: ufw muda de estado quando as regras são adicionadas."""

    def __init__(self, ufw_status: str):
        self.ufw_status = ufw_status
        self.calls: list[list[str]] = []

    def run(self, args: list[str]) -> tuple[int, str]:
        self.calls.append(args)
        if args[:2] == ["ip", "-j"]:
            return 0, IP_JSON
        if args[:3] == ["ufw", "status", "verbose"]:
            return 0, self.ufw_status
        if args[:2] == ["ufw", "allow"]:
            port, proto = args[7], args[9]
            self.ufw_status += f"{port}/{proto}                   ALLOW IN    {args[3]}\n"
            return 0, "Rule added"
        return 127, ""


@pytest.fixture
def sistema(monkeypatch):
    fake = FakeSystem(UFW_BLOQUEANDO)
    monkeypatch.setattr(netcheck, "run_command", fake.run)
    monkeypatch.setattr(server_cli, "lan_addresses", lambda: ["192.168.0.14"])
    monkeypatch.setattr(server_cli, "_is_root", lambda: True)
    monkeypatch.setattr(
        netcheck, "probe", lambda url, timeout=2.0: {"app": "rpgplay", "name": "Casa", "version": "0.2.1"}
    )
    monkeypatch.setenv("RPG_DISCOVERY_ENABLED", "true")
    server_cli.get_settings.cache_clear()
    yield fake
    server_cli.get_settings.cache_clear()


def test_diagnostico_aponta_o_firewall_e_liberar_resolve(sistema, capsys):
    assert server_cli.main(["diagnostico"]) == 1
    out = capsys.readouterr().out
    assert "✔ Servidor respondendo na porta 8080" in out
    assert "http://192.168.0.14:8080  (rede 192.168.0.0/24)" in out
    assert "✘ Firewall ufw: porta 8080/tcp (celulares e painel) bloqueada para 192.168.0.0/24" in out
    assert "sudo rpgplay-server liberar-firewall" in out

    assert server_cli.main(["liberar-firewall"]) == 0
    out = capsys.readouterr().out
    assert "ufw allow from 192.168.0.0/24 to any port 8080 proto tcp" in out
    assert "só para a rede de casa (192.168.0.0/24)" in out

    # Idempotente: rodar de novo não duplica regra.
    assert server_cli.main(["liberar-firewall"]) == 0
    assert "já estão liberadas" in capsys.readouterr().out
    assert sum(1 for c in sistema.calls if c[:2] == ["ufw", "allow"]) == 2

    assert server_cli.main(["diagnostico"]) == 0
    out = capsys.readouterr().out
    assert "✔ Firewall ufw: porta 8080/tcp (celulares e painel) liberada para 192.168.0.0/24" in out
    assert "Deste lado está tudo certo" in out


def test_diagnostico_sem_servidor_e_sem_root(sistema, monkeypatch, capsys):
    monkeypatch.setattr(netcheck, "probe", lambda url, timeout=2.0: None)
    monkeypatch.setattr(server_cli, "_is_root", lambda: False)
    assert server_cli.main(["diagnostico"]) == 1
    out = capsys.readouterr().out
    assert "o servidor está parado" in out and "systemctl restart rpgplay-server" in out
    assert "Rode com sudo para conferir o firewall" in out
    assert server_cli.main(["liberar-firewall"]) == 1
    assert "Rode com sudo" in capsys.readouterr().err


def test_sem_firewall_nao_ha_o_que_liberar(sistema, capsys):
    sistema.ufw_status = "Status: inactive\n"
    assert server_cli.main(["liberar-firewall"]) == 0
    assert "Nenhum firewall ativo" in capsys.readouterr().out
