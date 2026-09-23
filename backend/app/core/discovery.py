"""Descoberta na rede local.

Os clientes (app dos jogadores e programa do Mestre) mandam um broadcast UDP com
``RPGPLAY_DISCOVER`` para a porta 47777; cada servidor responde para quem perguntou com um JSON
``{"app": "rpgplay", "name": ..., "port": 8080, ...}``. O IP vem do próprio pacote de resposta.
Quem não consegue usar UDP (ou está numa rede que bloqueia broadcast) varre a sub-rede em
``GET /api/v1/discovery``, que devolve o mesmo JSON.
"""

import asyncio
import json
import logging
import socket
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

MAGIC = b"RPGPLAY_DISCOVER"


class DiscoveryProtocol(asyncio.DatagramProtocol):
    def __init__(self, payload: Callable[[], dict[str, Any]]) -> None:
        self._payload = payload
        self.transport: asyncio.DatagramTransport | None = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport  # type: ignore[assignment]

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        if not data.strip().startswith(MAGIC) or self.transport is None:
            return
        self.transport.sendto(json.dumps(self._payload()).encode(), addr)


async def start_discovery(port: int, payload: Callable[[], dict[str, Any]], host: str = "0.0.0.0"):
    """Sobe o responder; devolve o transporte (feche no shutdown) ou None se a porta estiver ocupada."""
    loop = asyncio.get_running_loop()
    try:
        transport, _ = await loop.create_datagram_endpoint(
            lambda: DiscoveryProtocol(payload), local_addr=(host, port), allow_broadcast=True
        )
    except OSError as exc:
        logger.warning("Descoberta UDP desativada (porta %s indisponível: %s)", port, exc)
        return None
    logger.info("Descoberta UDP escutando na porta %s", port)
    return transport


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
