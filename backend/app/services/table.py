"""Mesa virtual: visões (Mestre vê tudo, jogador vê só a própria cena) e quem recebe cada evento."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import DomainError, ForbiddenError, NotFoundError
from app.models import Character, Npc, Room, RoomMember, Scene, Token, User
from app.models.enums import RoomRole
from app.services.hp import CONDITION_LABEL, condition
from app.services.media import MediaStore


def require_master(room: Room, user: User) -> None:
    if room.master_id != user.id:
        raise ForbiddenError("Só o Mestre pode mexer na mesa.")


async def get_room(session: AsyncSession, room_id: uuid.UUID) -> Room:
    room = await session.get(Room, room_id)
    if room is None:
        raise NotFoundError("Mesa não encontrada.")
    return room


def check_room_media_key(room: Room, key: str | None) -> None:
    """Só aceita imagens enviadas para esta mesa (evita apontar para arquivos de outra campanha)."""
    if key is not None and not key.startswith(f"rooms/{room.id}/"):
        raise DomainError("Imagem inválida para esta mesa.")


# ---------- serialização ----------


def scene_out(scene: Scene, media: MediaStore) -> dict[str, Any]:
    return {
        "id": str(scene.id),
        "name": scene.name,
        "map_url": media.url(scene.map_key) if scene.map_key else None,
        "map_key": scene.map_key,
        "map_width": scene.map_width,
        "map_height": scene.map_height,
        "grid_size": scene.grid_size,
        "grid_visible": scene.grid_visible,
        "sort_order": scene.sort_order,
    }


def npc_master_out(npc: Npc, media: MediaStore) -> dict[str, Any]:
    state = condition(npc.hp_current, npc.hp_max)
    return {
        "id": str(npc.id),
        "name": npc.name,
        "portrait_url": media.url(npc.portrait_key) if npc.portrait_key else None,
        "portrait_key": npc.portrait_key,
        "hp_max": npc.hp_max,
        "hp_current": npc.hp_current,
        "hp_temp": npc.hp_temp,
        "armor_class": npc.armor_class,
        "attributes": npc.attributes or {},
        "notes": npc.notes,
        "version": npc.version,
        "condition": state,
        "condition_label": CONDITION_LABEL[state],
    }


def npc_public_out(npc: Npc, media: MediaStore) -> dict[str, Any]:
    """O que os jogadores sabem de um inimigo: nome, imagem e um estado vago."""
    state = condition(npc.hp_current, npc.hp_max)
    return {
        "id": str(npc.id),
        "name": npc.name,
        "portrait_url": media.url(npc.portrait_key) if npc.portrait_key else None,
        "condition": state,
        "condition_label": CONDITION_LABEL[state],
    }


def token_out(token: Token) -> dict[str, Any]:
    return {
        "id": str(token.id),
        "scene_id": str(token.scene_id),
        "character_id": str(token.character_id) if token.character_id else None,
        "npc_id": str(token.npc_id) if token.npc_id else None,
        "x": token.x,
        "y": token.y,
        "size": token.size,
        "hidden": token.hidden,
        "z": token.z,
        "version": token.version,
    }


async def party_out(session: AsyncSession, room: Room, media: MediaStore) -> list[dict[str, Any]]:
    """Personagens sentados à mesa (todos veem nome, classe e PV do grupo)."""
    rows = (
        await session.execute(
            select(RoomMember, Character)
            .join(Character, Character.id == RoomMember.character_id)
            .where(RoomMember.room_id == room.id, RoomMember.kicked_at.is_(None))
        )
    ).all()
    return [
        {
            "id": str(c.id),
            "owner_id": str(m.user_id),
            "name": c.name,
            "class_name": c.class_name,
            "ancestry_name": c.ancestry_name,
            "level": c.level,
            "portrait_url": media.url(c.portrait_key) if c.portrait_key else None,
            "hp_current": c.hp_current,
            "hp_max": c.hp_max,
            "hp_temp": c.hp_temp,
            "version": c.version,
        }
        for m, c in rows
    ]


# ---------- visões ----------


async def player_scene_id(session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID | None:
    """Cena onde está o boneco do personagem do jogador (o jogador só enxerga essa)."""
    return await session.scalar(
        select(Token.scene_id)
        .join(RoomMember, (RoomMember.character_id == Token.character_id) & (RoomMember.room_id == Token.room_id))
        .where(Token.room_id == room_id, RoomMember.user_id == user_id, RoomMember.kicked_at.is_(None))
    )


async def scene_view(session: AsyncSession, scene: Scene, media: MediaStore) -> dict[str, Any]:
    """Uma cena como o jogador vê: sem tokens escondidos e com inimigos no formato público."""
    tokens = (await session.scalars(select(Token).where(Token.scene_id == scene.id, Token.hidden.is_(False)))).all()
    npc_ids = {t.npc_id for t in tokens if t.npc_id}
    npcs = (await session.scalars(select(Npc).where(Npc.id.in_(npc_ids)))).all() if npc_ids else []
    return {
        "scene": scene_out(scene, media),
        "tokens": [token_out(t) for t in tokens],
        "npcs": [npc_public_out(n, media) for n in npcs],
    }


async def table_view(session: AsyncSession, room: Room, member: RoomMember, media: MediaStore) -> dict[str, Any]:
    party = await party_out(session, room, media)
    if member.role == RoomRole.MASTER:
        scenes = (
            await session.scalars(
                select(Scene).where(Scene.room_id == room.id).order_by(Scene.sort_order, Scene.created_at)
            )
        ).all()
        tokens = (await session.scalars(select(Token).where(Token.room_id == room.id))).all()
        npcs = (await session.scalars(select(Npc).where(Npc.room_id == room.id).order_by(Npc.created_at))).all()
        return {
            "role": "master",
            "scenes": [scene_out(s, media) for s in scenes],
            "tokens": [token_out(t) for t in tokens],
            "npcs": [npc_master_out(n, media) for n in npcs],
            "party": party,
        }
    scene_id = await player_scene_id(session, room.id, member.user_id)
    scene = await session.get(Scene, scene_id) if scene_id else None
    if scene is None:
        return {"role": "player", "scene": None, "tokens": [], "npcs": [], "party": party}
    return {"role": "player", **(await scene_view(session, scene, media)), "party": party}


# ---------- audiência dos eventos ----------


async def scene_players(session: AsyncSession, room: Room, scene_id: uuid.UUID) -> list[uuid.UUID]:
    """Jogadores cujo personagem está com o boneco nesta cena."""
    rows = await session.scalars(
        select(RoomMember.user_id)
        .join(Token, (Token.character_id == RoomMember.character_id) & (Token.room_id == RoomMember.room_id))
        .where(Token.scene_id == scene_id, RoomMember.room_id == room.id, RoomMember.kicked_at.is_(None))
    )
    return [uid for uid in rows.all() if uid != room.master_id]


async def npc_viewers(session: AsyncSession, room: Room, npc_id: uuid.UUID) -> list[uuid.UUID]:
    """Jogadores que enxergam este inimigo (há um boneco visível dele na cena deles)."""
    scene_ids = (
        await session.scalars(select(Token.scene_id).where(Token.npc_id == npc_id, Token.hidden.is_(False)))
    ).all()
    viewers: set[uuid.UUID] = set()
    for scene_id in set(scene_ids):
        viewers.update(await scene_players(session, room, scene_id))
    return list(viewers)


async def owner_of_character(session: AsyncSession, room: Room, character_id: uuid.UUID) -> uuid.UUID | None:
    return await session.scalar(
        select(RoomMember.user_id).where(
            RoomMember.room_id == room.id, RoomMember.character_id == character_id, RoomMember.kicked_at.is_(None)
        )
    )
