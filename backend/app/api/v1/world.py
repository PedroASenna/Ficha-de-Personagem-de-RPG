"""Mapa-múndi da campanha com fichas de nações e facções e as relações entre elas.

Só fichas: nada é desenhado no mapa. O Mestre decide o que os jogadores já descobriram (`revealed`)
e quando a imagem do mapa fica visível para eles (`visible`).
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AppState, get_current_user, get_db, get_state
from app.core.errors import NotFoundError
from app.models import Faction, FactionRelation, User
from app.schemas.table import FactionIn, FactionPatch, RelationIn, WorldPatch
from app.services import rooms as room_service
from app.services import table as table_service
from app.services import world as service
from app.ws import table_events

router = APIRouter(tags=["mapa-múndi"])


async def _master_room(db: AsyncSession, room_id: uuid.UUID, user: User):
    room = await table_service.get_room(db, room_id)
    table_service.require_master(room, user)
    return room


@router.get("/rooms/{room_id}/world")
async def get_world(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    room = await table_service.get_room(db, room_id)
    await room_service.require_member(db, room, user)
    return await service.world_view(db, room, state.media, master=room.master_id == user.id)


@router.patch("/rooms/{room_id}/world")
async def update_world(
    room_id: uuid.UUID,
    data: WorldPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Troca a imagem do mapa-múndi (enviada com kind=map) e/ou mostra/esconde dos jogadores."""
    room = await _master_room(db, room_id, user)
    changes = data.model_dump(exclude_unset=True)
    old_key = room.world_map_key
    if "map_key" in changes:
        table_service.check_room_media_key(room, changes["map_key"])
        room.world_map_key = changes["map_key"]
        if changes["map_key"] is None:
            room.world_map_width = room.world_map_height = None
    if changes.get("map_width") is not None:
        room.world_map_width = changes["map_width"]
    if changes.get("map_height") is not None:
        room.world_map_height = changes["map_height"]
    if changes.get("visible") is not None:
        room.world_visible = changes["visible"]
    await db.commit()
    if old_key and old_key != room.world_map_key:
        await table_service.delete_unused_media(db, state.media, [old_key])
    await table_events.world_updated(state, db, room)
    return await service.world_view(db, room, state.media, master=True)


@router.post("/rooms/{room_id}/factions", status_code=status.HTTP_201_CREATED)
async def create_faction(
    room_id: uuid.UUID,
    data: FactionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    room = await _master_room(db, room_id, user)
    table_service.check_room_media_key(room, data.emblem_key)
    await service.check_parent(db, room, None, data.parent_id)
    order = await db.scalar(select(func.coalesce(func.max(Faction.sort_order), -1)).where(Faction.room_id == room.id))
    faction = Faction(room_id=room.id, sort_order=order + 1, version=1, **data.model_dump())
    faction.name = faction.name.strip()
    db.add(faction)
    await db.commit()
    await table_events.world_updated(state, db, room)
    return service.faction_master_out(faction, state.media)


async def _faction_and_room(db: AsyncSession, faction_id: uuid.UUID, user: User):
    faction = await db.get(Faction, faction_id)
    if faction is None:
        raise NotFoundError("Nação ou facção não encontrada.")
    return faction, await _master_room(db, faction.room_id, user)


@router.patch("/factions/{faction_id}")
async def update_faction(
    faction_id: uuid.UUID,
    data: FactionPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    faction, room = await _faction_and_room(db, faction_id, user)
    changes = data.model_dump(exclude_unset=True)
    if "emblem_key" in changes:
        table_service.check_room_media_key(room, changes["emblem_key"])
    if "parent_id" in changes:
        await service.check_parent(db, room, faction, changes["parent_id"])
    if changes.get("kind") == "faction" and faction.kind.value == "nation":
        # Uma nação que vira facção deixa de ter facções dentro dela.
        children = await db.scalars(select(Faction).where(Faction.parent_id == faction.id))
        for child in children:
            child.parent_id = None
            child.version += 1
    old_key = faction.emblem_key
    for key, value in changes.items():
        if value is not None or key in ("emblem_key", "parent_id"):
            setattr(faction, key, value.strip() if key == "name" else value)
    faction.version += 1
    await db.commit()
    if old_key and old_key != faction.emblem_key:
        await table_service.delete_unused_media(db, state.media, [old_key])
    await table_events.world_updated(state, db, room)
    return service.faction_master_out(faction, state.media)


@router.delete("/factions/{faction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_faction(
    faction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    faction, room = await _faction_and_room(db, faction_id, user)
    key = faction.emblem_key
    for child in await db.scalars(select(Faction).where(Faction.parent_id == faction.id)):
        child.parent_id = None
        child.version += 1
    await db.delete(faction)
    await db.commit()
    await table_service.delete_unused_media(db, state.media, [key])
    await table_events.world_updated(state, db, room)


@router.put("/rooms/{room_id}/relations")
async def set_relation(
    room_id: uuid.UUID,
    data: RelationIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Cria ou atualiza a relação entre duas nações/facções (aliança, amizade, neutra, tensão, guerra)."""
    room = await _master_room(db, room_id, user)
    a_id, b_id = service.ordered_pair(data.a_id, data.b_id)
    for faction_id in (a_id, b_id):
        await service.get_faction(db, room, faction_id)
    relation = await db.scalar(
        select(FactionRelation).where(FactionRelation.a_id == a_id, FactionRelation.b_id == b_id)
    )
    if relation is None:
        relation = FactionRelation(room_id=room.id, a_id=a_id, b_id=b_id, version=0)
        db.add(relation)
    relation.kind, relation.note, relation.revealed = data.kind, data.note.strip(), data.revealed
    relation.version += 1
    await db.commit()
    await table_events.world_updated(state, db, room)
    return service.relation_out(relation, master=True)


@router.delete("/relations/{relation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_relation(
    relation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    relation = await db.get(FactionRelation, relation_id)
    if relation is None:
        raise NotFoundError("Relação não encontrada.")
    room = await _master_room(db, relation.room_id, user)
    await db.delete(relation)
    await db.commit()
    await table_events.world_updated(state, db, room)
