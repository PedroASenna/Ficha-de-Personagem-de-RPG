"""Diagnóstico de rede do servidor da casa: por que o celular não conecta?

O caso mais comum é o firewall do computador do servidor (ufw no Debian/Ubuntu, firewalld no
Fedora/openSUSE) bloqueando a porta 8080. `rpgplay-server diagnostico` mostra o que está errado e
`rpgplay-server liberar-firewall` libera as portas **só para a rede de casa** (nunca para a internet:
muitos computadores têm IPv6 público, e liberar para "Anywhere" exporia o servidor).

As funções de análise recebem o texto dos comandos, então são testáveis sem firewall de verdade.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import shutil
import subprocess
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

Runner = Callable[[list[str]], tuple[int, str]]
Network = ipaddress.IPv4Network


def run_command(args: list[str]) -> tuple[int, str]:
    """Roda um comando e devolve (código, saída). Comando inexistente = 127."""
    if shutil.which(args[0]) is None:
        return 127, ""
    try:
        # Saída sempre em inglês: a análise não pode depender do idioma do sistema.
        env = {**os.environ, "LC_ALL": "C", "LANG": "C"}
        # errors="replace": no Windows o netsh escreve na página de código do console (ex.: cp850).
        done = subprocess.run(args, capture_output=True, text=True, errors="replace", timeout=15, check=False, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)
    return done.returncode, (done.stdout or "") + (done.stderr or "")


# ---------- redes da casa ----------


def parse_ip_addr_json(text: str) -> list[Network]:
    """Redes IPv4 a partir de `ip -j -4 addr` (ignora loopback e link-local)."""
    networks: list[Network] = []
    try:
        interfaces = json.loads(text)
    except json.JSONDecodeError:
        return networks
    for interface in interfaces:
        for info in interface.get("addr_info", []):
            if info.get("family") != "inet":
                continue
            try:
                network = ipaddress.ip_interface(f"{info['local']}/{info['prefixlen']}").network
            except (KeyError, ValueError):
                continue
            if network.is_loopback or network.is_link_local:
                continue
            networks.append(network)
    return networks


def home_networks(addresses: Iterable[str], ip_json: str | None) -> list[Network]:
    """Redes das interfaces que os celulares usam (as de `addresses`); sem `ip`, supõe /24."""
    wanted = [ipaddress.ip_address(a) for a in addresses]
    found = parse_ip_addr_json(ip_json) if ip_json else []
    result: list[Network] = []
    for address in wanted:
        network = next((n for n in found if address in n), None)
        if network is None:
            network = ipaddress.ip_network(f"{address}/24", strict=False)
        if network not in result:
            result.append(network)
    return result


# ---------- ufw ----------

_UFW_RULE = re.compile(
    r"^(?P<to>\S.*?)\s{2,}(?P<action>(?:ALLOW|DENY|REJECT|LIMIT)(?: IN| OUT| FWD)?)\s{2,}(?P<src>.+?)\s*$"
)


@dataclass
class PortState:
    port: int
    proto: str
    allowed_from: list[str] = field(default_factory=list)  # redes/IPs de origem liberados
    open_to_anyone: bool = False

    def covers(self, network: Network) -> bool:
        if self.open_to_anyone:
            return True
        for source in self.allowed_from:
            try:
                if network.subnet_of(ipaddress.ip_network(source, strict=False)):
                    return True
            except (ValueError, TypeError):
                continue
        return False


@dataclass
class FirewallReport:
    name: str  # "ufw" | "firewalld" | ""
    active: bool
    ports: dict[tuple[int, str], PortState] = field(default_factory=dict)
    default_allows_incoming: bool = False

    def state(self, port: int, proto: str) -> PortState:
        return self.ports.setdefault((port, proto), PortState(port, proto))

    def allows(self, port: int, proto: str, network: Network) -> bool:
        if not self.active or self.default_allows_incoming:
            return True
        return self.state(port, proto).covers(network)


def _ufw_to_matches(to: str, port: int, proto: str) -> bool:
    to = to.replace("(v6)", "").strip()
    if to.lower().startswith("anywhere"):
        return True
    target = to.split()[0]
    ports, _, rule_proto = target.partition("/")
    if rule_proto and rule_proto != proto:
        return False
    for chunk in ports.split(","):
        low, _, high = chunk.partition(":")
        try:
            if int(low) <= port <= int(high or low):
                return True
        except ValueError:
            continue
    return False


def parse_ufw(text: str, checks: Iterable[tuple[int, str]]) -> FirewallReport:
    """Analisa `ufw status verbose`."""
    report = FirewallReport("ufw", active="Status: active" in text)
    if not report.active:
        return report
    default = re.search(r"Default:\s*(\w+)\s*\(incoming\)", text)
    report.default_allows_incoming = bool(default and default.group(1).lower() == "allow")
    rules = [m for line in text.splitlines() if (m := _UFW_RULE.match(line.strip()))]
    for port, proto in checks:
        state = report.state(port, proto)
        for rule in rules:
            if not rule["action"].startswith(("ALLOW", "LIMIT")) or not _ufw_to_matches(rule["to"], port, proto):
                continue
            source = rule["src"].replace("(v6)", "").strip()
            if source.lower().startswith("anywhere"):
                state.open_to_anyone = True
            else:
                state.allowed_from.append(source.split()[0])
    return report


# ---------- firewalld ----------


def parse_firewalld(state_text: str, list_all: str, checks: Iterable[tuple[int, str]]) -> FirewallReport:
    """Analisa `firewall-cmd --state` e `firewall-cmd --list-all` (zona padrão)."""
    report = FirewallReport("firewalld", active=state_text.strip() == "running")
    if not report.active:
        return report
    target = re.search(r"^\s*target:\s*(\S+)", list_all, re.M)
    report.default_allows_incoming = bool(target and target.group(1).upper() == "ACCEPT")
    ports_line = re.search(r"^\s*ports:\s*(.*)$", list_all, re.M)
    open_ports = set(ports_line.group(1).split()) if ports_line else set()
    rich = re.findall(
        r"rule family=\"ipv4\" source address=\"([^\"]+)\" port port=\"(\d+)\" protocol=\"(\w+)\" accept", list_all
    )
    for port, proto in checks:
        state = report.state(port, proto)
        if f"{port}/{proto}" in open_ports:
            state.open_to_anyone = True
        for source, rule_port, rule_proto in rich:
            if int(rule_port) == port and rule_proto == proto:
                state.allowed_from.append(source)
    return report


def detect_firewall(run: Runner, checks: list[tuple[int, str]]) -> FirewallReport:
    code, text = run(["ufw", "status", "verbose"])
    if code == 0 and "Status: active" in text:
        return parse_ufw(text, checks)
    code, state_text = run(["firewall-cmd", "--state"])
    if code == 0 and state_text.strip() == "running":
        _, list_all = run(["firewall-cmd", "--list-all"])
        return parse_firewalld(state_text, list_all, checks)
    return FirewallReport("", active=False)


def firewall_commands(
    report: FirewallReport, networks: list[Network], checks: list[tuple[int, str]]
) -> list[list[str]]:
    """Comandos que liberam as portas só para as redes da casa (vazio se já está tudo liberado)."""
    commands: list[list[str]] = []
    missing = [(port, proto, net) for port, proto in checks for net in networks if not report.allows(port, proto, net)]
    for port, proto, net in missing:
        if report.name == "ufw":
            commands.append(["ufw", "allow", "from", str(net), "to", "any", "port", str(port), "proto", proto])
        elif report.name == "firewalld":
            rule = f'rule family="ipv4" source address="{net}" port port="{port}" protocol="{proto}" accept'
            commands.append(["firewall-cmd", "--permanent", f"--add-rich-rule={rule}"])
    if commands and report.name == "firewalld":
        commands.append(["firewall-cmd", "--reload"])
    return commands


def shell_join(command: list[str]) -> str:
    return " ".join(f"'{part}'" if any(c in part for c in ' ="') else part for part in command)


# ---------- o servidor responde? ----------


def probe(url: str, timeout: float = 2.0) -> dict | None:
    try:
        with urllib.request.urlopen(f"{url}/api/v1/discovery", timeout=timeout) as response:  # noqa: S310 (rede local)
            data = json.loads(response.read().decode())
            return data if data.get("app") == "rpgplay" else None
    except (OSError, ValueError):
        return None
