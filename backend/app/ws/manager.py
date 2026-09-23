"""Conexões WebSocket locais desta instância, agrupadas por sala."""

import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from app.models.enums import RoomRole
from app.ws.protocol import CLOSE_FORBIDDEN, CLOSE_ROOM_CLOSED

logger = logging.getLogger(__name__)


@dataclass(eq=False)
class Connection:
    websocket: WebSocket
    user_id: uuid.UUID
    role: RoomRole
    id: uuid.UUID = field(default_factory=uuid.uuid4)


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[uuid.UUID, set[Connection]] = defaultdict(set)

    def add(self, room_id: uuid.UUID, conn: Connection) -> None:
        self._rooms[room_id].add(conn)

    def remove(self, room_id: uuid.UUID, conn: Connection) -> None:
        conns = self._rooms.get(room_id)
        if conns is not None:
            conns.discard(conn)
            if not conns:
                self._rooms.pop(room_id, None)

    def online_user_ids(self, room_id: uuid.UUID) -> set[uuid.UUID]:
        return {c.user_id for c in self._rooms.get(room_id, ())}

    async def deliver(self, room_id: uuid.UUID, message: dict[str, Any], audience: list[str] | None) -> None:
        """Entrega local. audience=None → todos da sala; senão, só os user_ids listados."""
        allowed = set(audience) if audience is not None else None
        for conn in list(self._rooms.get(room_id, ())):
            if allowed is not None and str(conn.user_id) not in allowed:
                continue
            try:
                await conn.websocket.send_json(message)
            except Exception:  # conexão morta: limpa e segue
                logger.debug("Falha ao enviar para %s; removendo conexão", conn.user_id)
                self.remove(room_id, conn)
                continue
            await self._apply_side_effects(room_id, conn, message)

    async def _apply_side_effects(self, room_id: uuid.UUID, conn: Connection, message: dict[str, Any]) -> None:
        msg_type = message.get("type")
        if msg_type == "member.kicked" and message.get("user_id") == str(conn.user_id):
            await self._close(room_id, conn, CLOSE_FORBIDDEN)
        elif msg_type == "room.closed":
            await self._close(room_id, conn, CLOSE_ROOM_CLOSED)

    async def _close(self, room_id: uuid.UUID, conn: Connection, code: int) -> None:
        self.remove(room_id, conn)
        try:
            await conn.websocket.close(code=code)
        except Exception:
            pass
