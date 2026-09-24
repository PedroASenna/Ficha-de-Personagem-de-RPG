"""Mapa-múndi, nações e facções: o Mestre vê tudo; os jogadores, só o que foi revelado."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import DomainError, NotFoundError
from app.models import Faction, FactionRelation, Room, RoomMember
from app.models.enums import RoomRole
from app.services.media import MediaStore


def faction_master_out(faction: Faction, media: MediaStore) -> dict[str, Any]:
    return {
        "id": str(faction.id),
        "kind": faction.kind.value,
        "name": faction.name,
        "emblem_key": faction.emblem_key,
        "emblem_url": media.url(faction.emblem_key) if faction.emblem_key else None,
        "color": faction.color,
        "leader": faction.leader,
        "seat": faction.seat,
        "description": faction.description,
        "secret_notes": faction.secret_notes,
        "parent_id": str(faction.parent_id) if faction.parent_id else None,
        "revealed": faction.revealed,
        "sort_order": faction.sort_order,
        "version": faction.version,
    }


def faction_public_out(faction: Faction, media: MediaStore, revealed_ids: set[uuid.UUID]) -> dict[str, Any]:
    """Ficha que os jogadores veem: sem notas secretas, e a nação-mãe só se ela também foi revelada."""
    return {
        "id": str(faction.id),
        "kind": faction.kind.value,
        "name": faction.name,
        "emblem_url": media.url(faction.emblem_key) if faction.emblem_key else None,
        "color": faction.color,
        "leader": faction.leader,
        "seat": faction.seat,
        "description": faction.description,
        "parent_id": str(faction.parent_id) if faction.parent_id in revealed_ids else None,
        "sort_order": faction.sort_order,
    }


def relation_out(relation: FactionRelation, *, master: bool) -> dict[str, Any]:
    data = {
        "id": str(relation.id),
        "a_id": str(relation.a_id),
        "b_id": str(relation.b_id),
        "kind": relation.kind.value,
        "note": relation.note,
    }
    return {**data, "revealed": relation.revealed, "version": relation.version} if master else data


async def world_view(session: AsyncSession, room: Room, media: MediaStore, *, master: bool) -> dict[str, Any]:
    factions = (
        await session.scalars(
            select(Faction)
            .where(Faction.room_id == room.id)
            .order_by(Faction.kind.desc(), Faction.sort_order, Faction.name)  # nações primeiro
        )
    ).all()
    relations = (await session.scalars(select(FactionRelation).where(FactionRelation.room_id == room.id))).all()
    has_map = room.world_map_key is not None
    base = {
        "map_width": room.world_map_width,
        "map_height": room.world_map_height,
        "visible": room.world_visible,
    }
    if master:
        return {
            **base,
            "map_key": room.world_map_key,
            "map_url": media.url(room.world_map_key) if has_map else None,
            "factions": [faction_master_out(f, media) for f in factions],
            "relations": [relation_out(r, master=True) for r in relations],
        }
    revealed = {f.id for f in factions if f.revealed}
    return {
        **base,
        "map_url": media.url(room.world_map_key) if has_map and room.world_visible else None,
        "factions": [faction_public_out(f, media, revealed) for f in factions if f.revealed],
        "relations": [
            relation_out(r, master=False)
            for r in relations
            if r.revealed and r.a_id in revealed and r.b_id in revealed
        ],
    }


async def player_ids(session: AsyncSession, room: Room) -> list[uuid.UUID]:
    rows = await session.scalars(
        select(RoomMember.user_id).where(
            RoomMember.room_id == room.id, RoomMember.kicked_at.is_(None), RoomMember.role == RoomRole.PLAYER
        )
    )
    return [uid for uid in rows.all() if uid != room.master_id]


async def get_faction(session: AsyncSession, room: Room, faction_id: uuid.UUID) -> Faction:
    faction = await session.get(Faction, faction_id)
    if faction is None or faction.room_id != room.id:
        raise NotFoundError("Nação ou facção não encontrada.")
    return faction


async def check_parent(
    session: AsyncSession, room: Room, faction: Faction | None, parent_id: uuid.UUID | None
) -> None:
    """A nação-mãe precisa ser uma nação desta campanha (e não a própria facção)."""
    if parent_id is None:
        return
    parent = await get_faction(session, room, parent_id)
    if parent.kind.value != "nation":
        raise DomainError("Uma facção só pode pertencer a uma nação.")
    if faction is not None and parent.id == faction.id:
        raise DomainError("Uma nação não pode estar dentro dela mesma.")


def ordered_pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    if a == b:
        raise DomainError("Escolha duas nações/facções diferentes.")
    return (a, b) if str(a) < str(b) else (b, a)
