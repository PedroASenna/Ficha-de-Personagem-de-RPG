"""De onde vem a requisição: da rede de casa ou da internet?

Os túneis gratuitos (Cloudflare Quick Tunnel e Tailscale Funnel) entregam as conexões de fora numa porta só
deles, em 127.0.0.1 (``Settings.remote_port``). Então "veio pela internet" é "chegou por essa porta". Por
garantia também contam os cabeçalhos que esses túneis sempre colocam. O erro possível é só para o lado seguro:
alguém da rede de casa que forje o cabeçalho passa a ser tratado como de fora.

Um IP público sozinho não conta: com IPv6 os celulares da própria casa têm IP público, e quem abriu a porta no
roteador por conta própria continua como antes.
"""

from collections.abc import Mapping
from typing import Any

from app.core.config import Settings

TUNNEL_HEADERS = (b"cf-connecting-ip", b"tailscale-funnel-request")


def _header(scope: Mapping[str, Any], name: bytes) -> str | None:
    for key, value in scope.get("headers") or []:
        if key.lower() == name:
            return value.decode("latin-1").strip()
    return None


def client_ip(scope: Mapping[str, Any]) -> str:
    client = scope.get("client")
    return str(client[0]) if client else "?"


def is_remote(scope: Mapping[str, Any], settings: Settings) -> bool:
    server = scope.get("server")
    if server and len(server) > 1 and server[1] == settings.remote_port:
        return True
    return any(_header(scope, name) is not None for name in TUNNEL_HEADERS)


def client_key(scope: Mapping[str, Any], settings: Settings) -> str:
    """Quem é o cliente, para limitar tentativas. Pelo túnel, o IP de verdade vem no cabeçalho da Cloudflare
    (o uvicorn já aplica o X-Forwarded-For vindo de 127.0.0.1); fora do túnel o cabeçalho é ignorado."""
    if is_remote(scope, settings):
        forwarded = _header(scope, b"cf-connecting-ip")
        if forwarded:
            return forwarded
    return client_ip(scope)
