"""Eventos da mesa: grava no log da sessão e distribui pelo WebSocket.

Usado tanto pelo handler do WebSocket quanto pela API REST (ex.: dano aplicado pela ficha fora do
WebSocket também aparece para o Mestre).
"""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Character, Room, RoomMember
from app.models.enums import RoomStatus, SessionEventType, Visibility
from app.services.dice import Tier
from app.services.rooms import record_event
from app.ws.broadcaster import Broadcaster
from app.ws.protocol import server_message

TIER_SUFFIX = {
    Tier.CRITICAL_SUCCESS: " — CRÍTICO!",
    Tier.CRITICAL_FAILURE: " — falha crítica!",
}


def roll_summary(actor: str, character: str | None, label: str | None, notation: str, total: int, tier: str) -> str:
    who = character or actor
    what = f" ({label})" if label else ""
    return f"{who} rolou {notation}{what} = {total}{TIER_SUFFIX.get(Tier(tier), '')}"


def hp_summary(name: str, transition: dict[str, Any]) -> str:
    hp = f"{transition['hp_current']}/{transition['hp_max']} PV"
    kind = transition["kind"]
    if kind == "damage":
        extra = (
            f", {transition['absorbed_by_temp']} absorvido por PV temporário" if transition["absorbed_by_temp"] else ""
        )
        down = " — CAÍDO!" if transition["hp_current"] == 0 else ""
        return f"{name} sofreu {transition['delta']} de dano{extra} ({hp}){down}"
    if kind == "heal":
        return f"{name} recuperou {transition['hp_current'] - transition['hp_before']} PV ({hp})"
    if kind == "rest":
        return f"{name} fez um descanso ({hp})"
    return f"{name} ganhou {transition['hp_temp']} PV temporários"


async def rooms_with_character(session: AsyncSession, character_id: uuid.UUID) -> list[Room]:
    rows = await session.scalars(
        select(Room)
        .join(RoomMember, RoomMember.room_id == Room.id)
        .where(
            RoomMember.character_id == character_id,
            RoomMember.kicked_at.is_(None),
            Room.status == RoomStatus.OPEN,
        )
    )
    return list(rows.unique().all())


async def announce_hp_change(
    session: AsyncSession,
    broadcaster: Broadcaster,
    *,
    room_ids: list[uuid.UUID],
    actor_id: uuid.UUID,
    actor_name: str,
    character: Character,
    transition: dict[str, Any],
    event_type: SessionEventType = SessionEventType.HP_CHANGE,
) -> None:
    """Grava o evento em cada sala, faz commit e só então publica (o log nunca fica atrás do push)."""
    payload = {
        **{k: str(v) if isinstance(v, uuid.UUID) else v for k, v in transition.items()},
        "character": {"id": str(character.id), "name": character.name},
        "actor": {"user_id": str(actor_id), "display_name": actor_name},
        "summary": hp_summary(character.name, transition),
    }
    events = []
    for room_id in room_ids:
        event = await record_event(session, room_id, actor_id, event_type, payload, character_id=character.id)
        events.append((room_id, event.id))
    await session.commit()
    for room_id, event_id in events:
        await broadcaster.publish(room_id, server_message("hp.changed", event_id=event_id, **payload))


async def announce_roll(
    session: AsyncSession,
    broadcaster: Broadcaster,
    *,
    room_id: uuid.UUID,
    master_id: uuid.UUID,
    actor_id: uuid.UUID,
    character_id: uuid.UUID | None,
    visibility: Visibility,
    payload: dict[str, Any],
) -> None:
    event = await record_event(
        session,
        room_id,
        actor_id,
        SessionEventType.DICE_ROLL,
        payload,
        character_id=character_id,
        visibility=visibility,
    )
    await session.commit()
    audience = None if visibility == Visibility.PUBLIC else [str(master_id), str(actor_id)]
    message = server_message("roll.result", event_id=event.id, visibility=visibility.value, **payload)
    await broadcaster.publish(room_id, message, audience)


async def announce_level_up(
    session: AsyncSession,
    broadcaster: Broadcaster,
    *,
    room_ids: list[uuid.UUID],
    actor_id: uuid.UUID,
    character: Character,
    result: dict[str, Any],
    summary: str,
) -> None:
    """Grava "subiu de nível" no log de cada mesa do personagem e avisa todos (nível e PV aparecem no grupo)."""
    payload = {
        "character": {"id": str(character.id), "name": character.name},
        "level": result["level"],
        "hp_gain": result["hp_gain"],
        "attributes": result["attributes"],
        "hp_current": character.hp_current,
        "hp_max": character.hp_max,
        "hp_temp": character.hp_temp,
        "version": character.version,
        "summary": summary,
    }
    events = []
    for room_id in room_ids:
        event = await record_event(
            session, room_id, actor_id, SessionEventType.LEVEL_UP, payload, character_id=character.id
        )
        events.append((room_id, event.id))
    await session.commit()
    for room_id, event_id in events:
        await broadcaster.publish(room_id, server_message("character.leveled", event_id=event_id, **payload))
