"""Mensagens do WebSocket da sala (/ws/rooms/{pin}). Versão do protocolo: 1.

Cliente → servidor
    {"type": "auth", "token": "<access token>"}                  # 1ª mensagem, em até 5 s
    {"type": "ping"}
    {"type": "roll.request", "id": "<uuid do cliente>", "notation": "1d20+5",
     "character_id": "...", "label": "Ataque", "visibility": "public" | "master_only"}
    {"type": "hp.change", "character_id" | "npc_id": "...", "delta": 7, "kind": "damage" | "heal" | "temp",
     "expected_version": 12}
    {"type": "token.move", "token_id": "...", "x": 350.0, "y": 420.0}           # só o Mestre

Servidor → cliente
    welcome (com a mesa) · pong · presence · roll.result · hp.changed · member.kicked · room.closed · error
    scene.upserted/deleted · token.upserted/moved/deleted · npc.upserted/deleted · npc.hp.changed (Mestre)
    view.reset (a cena do jogador mudou)
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter, model_validator

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
    # Rolagem do Mestre por um inimigo (ataque do goblin...).
    npc_id: uuid.UUID | None = None
    label: str | None = Field(default=None, max_length=60)
    visibility: Literal["public", "master_only"] = "public"


class HpChangeMsg(BaseModel):
    type: Literal["hp.change"]
    # Personagem de jogador OU inimigo do Mestre (npc_id, só o Mestre).
    character_id: uuid.UUID | None = None
    npc_id: uuid.UUID | None = None
    delta: int = Field(ge=1, le=9999)
    kind: Literal["damage", "heal", "temp"]
    expected_version: int | None = None

    @model_validator(mode="after")
    def _one_target(self) -> "HpChangeMsg":
        if (self.character_id is None) == (self.npc_id is None):
            raise ValueError("Informe character_id OU npc_id.")
        return self


class TokenMoveMsg(BaseModel):
    """Só o Mestre move bonecos. Enviado durante o arrasto (~10/s) e ao soltar."""

    type: Literal["token.move"]
    token_id: uuid.UUID
    x: float = Field(ge=-10000, le=20000)
    y: float = Field(ge=-10000, le=20000)


ClientMessage = Annotated[PingMsg | RollRequestMsg | HpChangeMsg | TokenMoveMsg, Field(discriminator="type")]
client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def server_message(msg_type: str, **fields: Any) -> dict[str, Any]:
    return {"type": msg_type, "v": PROTOCOL_VERSION, "ts": now_iso(), **fields}


def error_message(code: str, message: str, ref: str | None = None) -> dict[str, Any]:
    return server_message("error", code=code, message=message, ref=ref)
