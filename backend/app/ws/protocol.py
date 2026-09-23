"""Mensagens do WebSocket da sala (/ws/rooms/{pin}). Versão do protocolo: 1.

Cliente → servidor
    {"type": "auth", "token": "<access token>"}                  # 1ª mensagem, em até 5 s
    {"type": "ping"}
    {"type": "roll.request", "id": "<uuid do cliente>", "notation": "1d20+5",
     "character_id": "...", "label": "Ataque", "visibility": "public" | "master_only"}
    {"type": "hp.change", "character_id": "...", "delta": 7, "kind": "damage" | "heal" | "temp",
     "expected_version": 12}

Servidor → cliente
    welcome · pong · presence · roll.result · hp.changed · member.kicked · room.closed · error
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter

PROTOCOL_VERSION = 1

# Códigos de fechamento (faixa 4000-4999 é livre para a aplicação).
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_NOT_FOUND = 4404
CLOSE_ROOM_CLOSED = 4410


class AuthMsg(BaseModel):
    type: Literal["auth"]
    token: str = Field(max_length=2048)


class PingMsg(BaseModel):
    type: Literal["ping"]


class RollRequestMsg(BaseModel):
    type: Literal["roll.request"]
    id: str = Field(min_length=1, max_length=64)
    notation: str = Field(min_length=1, max_length=64)
    character_id: uuid.UUID | None = None
    label: str | None = Field(default=None, max_length=60)
    visibility: Literal["public", "master_only"] = "public"


class HpChangeMsg(BaseModel):
    type: Literal["hp.change"]
    character_id: uuid.UUID
    delta: int = Field(ge=1, le=9999)
    kind: Literal["damage", "heal", "temp"]
    expected_version: int | None = None


ClientMessage = Annotated[PingMsg | RollRequestMsg | HpChangeMsg, Field(discriminator="type")]
client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def server_message(msg_type: str, **fields: Any) -> dict[str, Any]:
    return {"type": msg_type, "v": PROTOCOL_VERSION, "ts": now_iso(), **fields}


def error_message(code: str, message: str, ref: str | None = None) -> dict[str, Any]:
    return server_message("error", code=code, message=message, ref=ref)
