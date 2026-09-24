"""Mesa virtual: visões (Mestre vê tudo, jogador vê só a própria cena) e quem recebe cada evento."""

import math
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import DomainError, ForbiddenError, NotFoundError
from app.models import Character, Faction, Npc, Room, RoomMember, Scene, SceneImage, SceneObject, Token, User
from app.models.enums import RoomRole
from app.rulesets.loader import get_registry
from app.services import engines
from app.services import fog as fog_service
from app.services import world as world_service
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
    cols, rows, cell = fog_service.geometry(scene)
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
        "fog_enabled": scene.fog_enabled,
        "fog_radius": scene.fog_radius,
        "fog_cols": cols,
        "fog_rows": rows,
        "fog_cell": cell,
    }


def image_out(image: SceneImage, media: MediaStore) -> dict[str, Any]:
    return {
        "id": str(image.id),
        "scene_id": str(image.scene_id),
        "image_key": image.image_key,
        "url": media.url(image.image_key),
        "x": image.x,
        "y": image.y,
        "width": image.width,
        "height": image.height,
        "rotation": image.rotation,
        "z": image.z,
        "locked": image.locked,
        "version": image.version,
    }


def object_out(obj: SceneObject, media: MediaStore) -> dict[str, Any]:
    return {
        "id": str(obj.id),
        "scene_id": str(obj.scene_id),
        "name": obj.name,
        "image_key": obj.image_key,
        "url": media.url(obj.image_key) if obj.image_key else None,
        "x": obj.x,
        "y": obj.y,
        "width": obj.width,
        "height": obj.height,
        "rotation": obj.rotation,
        "z": obj.z,
        "hide_occupants": obj.hide_occupants,
        "version": obj.version,
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
        "rotation": token.rotation,
        "container_id": str(token.container_id) if token.container_id else None,
        "version": token.version,
    }


def token_visible(token: Token, container: SceneObject | None, viewer_character_id: uuid.UUID | None) -> bool:
    """Jogador vê o boneco? Escondidos, nunca; dentro de objeto que esconde ocupantes, só o próprio."""
    if token.hidden:
        return False
    if container is not None and container.hide_occupants:
        return viewer_character_id is not None and token.character_id == viewer_character_id
    return True


def level_label(character: Character) -> str:
    """ "Nível 3" nos sistemas clássicos; pontos (GURPS) ou Estágio (Savage Worlds) nos outros."""
    pack = get_registry().get(character.ruleset_id)
    if pack is None or not engines.uses_engine(pack):
        return f"Nível {character.level}"
    return engines.level_label(pack, character)


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
            "level_label": level_label(c),
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


async def scene_view(
    session: AsyncSession, scene: Scene, media: MediaStore, character_id: uuid.UUID | None = None
) -> dict[str, Any]:
    """Uma cena como o jogador vê: sem bonecos escondidos, inimigos no formato público e a névoa dele."""
    objects = (
        await session.scalars(
            select(SceneObject).where(SceneObject.scene_id == scene.id).order_by(SceneObject.z, SceneObject.created_at)
        )
    ).all()
    by_id = {o.id: o for o in objects}
    tokens = [
        t
        for t in (await session.scalars(select(Token).where(Token.scene_id == scene.id))).all()
        if token_visible(t, by_id.get(t.container_id) if t.container_id else None, character_id)
    ]
    npc_ids = {t.npc_id for t in tokens if t.npc_id}
    npcs = (await session.scalars(select(Npc).where(Npc.id.in_(npc_ids)))).all() if npc_ids else []
    images = (
        await session.scalars(
            select(SceneImage).where(SceneImage.scene_id == scene.id).order_by(SceneImage.z, SceneImage.created_at)
        )
    ).all()
    fog = await fog_service.character_fog(session, scene, character_id) if scene.fog_enabled and character_id else None
    return {
        "scene": scene_out(scene, media),
        "tokens": [token_out(t) for t in tokens],
        "npcs": [npc_public_out(n, media) for n in npcs],
        "images": [image_out(i, media) for i in images],
        "objects": [object_out(o, media) for o in objects],
        "fog": fog,
    }


async def table_view(session: AsyncSession, room: Room, member: RoomMember, media: MediaStore) -> dict[str, Any]:
    party = await party_out(session, room, media)
    is_master = member.role == RoomRole.MASTER
    world = await world_service.world_view(session, room, media, master=is_master)
    if is_master:
        scenes = (
            await session.scalars(
                select(Scene).where(Scene.room_id == room.id).order_by(Scene.sort_order, Scene.created_at)
            )
        ).all()
        tokens = (await session.scalars(select(Token).where(Token.room_id == room.id))).all()
        npcs = (await session.scalars(select(Npc).where(Npc.room_id == room.id).order_by(Npc.created_at))).all()
        images = (
            await session.scalars(
                select(SceneImage).where(SceneImage.room_id == room.id).order_by(SceneImage.z, SceneImage.created_at)
            )
        ).all()
        objects = (
            await session.scalars(
                select(SceneObject)
                .where(SceneObject.room_id == room.id)
                .order_by(SceneObject.z, SceneObject.created_at)
            )
        ).all()
        fog = [entry for scene in scenes for entry in await fog_service.scene_fog(session, scene)]
        return {
            "role": "master",
            "scenes": [scene_out(s, media) for s in scenes],
            "tokens": [token_out(t) for t in tokens],
            "npcs": [npc_master_out(n, media) for n in npcs],
            "images": [image_out(i, media) for i in images],
            "objects": [object_out(o, media) for o in objects],
            "fog": fog,
            "party": party,
            "world": world,
        }
    scene_id = await player_scene_id(session, room.id, member.user_id)
    scene = await session.get(Scene, scene_id) if scene_id else None
    if scene is None:
        empty = {"scene": None, "tokens": [], "npcs": [], "images": [], "objects": [], "fog": None}
        return {"role": "player", **empty, "party": party, "world": world}
    view = await scene_view(session, scene, media, member.character_id)
    return {"role": "player", **view, "party": party, "world": world}


# ---------- audiência dos eventos ----------


async def scene_players(session: AsyncSession, room: Room, scene_id: uuid.UUID) -> list[uuid.UUID]:
    """Jogadores cujo personagem está com o boneco nesta cena."""
    return list(await scene_audience(session, room, scene_id))


async def scene_audience(session: AsyncSession, room: Room, scene_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID]:
    """Jogadores na cena → personagem de cada um (para filtrar o que cada um enxerga)."""
    rows = await session.execute(
        select(RoomMember.user_id, RoomMember.character_id)
        .join(Token, (Token.character_id == RoomMember.character_id) & (Token.room_id == RoomMember.room_id))
        .where(Token.scene_id == scene_id, RoomMember.room_id == room.id, RoomMember.kicked_at.is_(None))
    )
    return {uid: cid for uid, cid in rows.all() if uid != room.master_id}


async def npc_viewers(session: AsyncSession, room: Room, npc_id: uuid.UUID) -> list[uuid.UUID]:
    """Jogadores que enxergam este inimigo (há um boneco visível dele na cena deles)."""
    rows = (
        await session.execute(
            select(Token, SceneObject)
            .outerjoin(SceneObject, SceneObject.id == Token.container_id)
            .where(Token.npc_id == npc_id, Token.hidden.is_(False))
        )
    ).all()
    scene_ids = {token.scene_id for token, container in rows if token_visible(token, container, None)}
    viewers: set[uuid.UUID] = set()
    for scene_id in scene_ids:
        viewers.update(await scene_players(session, room, scene_id))
    return list(viewers)


async def container_in_scene(session: AsyncSession, room: Room, container_id: uuid.UUID, scene_id: uuid.UUID):
    obj = await session.get(SceneObject, container_id)
    if obj is None or obj.room_id != room.id or obj.scene_id != scene_id:
        raise DomainError("O objeto precisa estar na mesma cena do boneco.")
    return obj


async def media_in_use(session: AsyncSession, key: str) -> bool:
    """Alguma coisa da mesa ainda aponta para esta imagem? (peças copiadas reaproveitam o arquivo)"""
    checks = (
        select(func.count()).select_from(SceneImage).where(SceneImage.image_key == key),
        select(func.count()).select_from(SceneObject).where(SceneObject.image_key == key),
        select(func.count()).select_from(Scene).where(Scene.map_key == key),
        select(func.count()).select_from(Npc).where(Npc.portrait_key == key),
        select(func.count()).select_from(Faction).where(Faction.emblem_key == key),
        select(func.count()).select_from(Room).where(Room.world_map_key == key),
    )
    for query in checks:
        if await session.scalar(query):
            return True
    return False


async def delete_unused_media(session: AsyncSession, media: MediaStore, keys) -> None:  # noqa: ANN001
    for key in {k for k in keys if k}:
        if not await media_in_use(session, key):
            await media.delete(key)


async def owner_of_character(session: AsyncSession, room: Room, character_id: uuid.UUID) -> uuid.UUID | None:
    return await session.scalar(
        select(RoomMember.user_id).where(
            RoomMember.room_id == room.id, RoomMember.character_id == character_id, RoomMember.kicked_at.is_(None)
        )
    )


# ---------- movimento: objetos que carregam bonecos e exploração da névoa ----------

Point = tuple[float, float]


async def occupants(session: AsyncSession, obj: SceneObject) -> list[Token]:
    return list((await session.scalars(select(Token).where(Token.container_id == obj.id))).all())


def carry(obj: SceneObject, tokens: list[Token], x: float, y: float, rotation: float) -> list[tuple[Token, Point]]:
    """Move o objeto e leva os ocupantes junto (girando em volta do centro, se o objeto girou).

    Devolve (boneco, posição anterior) de cada ocupante; o chamador grava a exploração e publica.
    """
    angle = math.radians(rotation - obj.rotation)
    cos, sin = math.cos(angle), math.sin(angle)
    moved = []
    for token in tokens:
        rx, ry = token.x - obj.x, token.y - obj.y
        old = (token.x, token.y)
        token.x = max(-10000.0, min(20000.0, x + rx * cos - ry * sin))
        token.y = max(-10000.0, min(20000.0, y + rx * sin + ry * cos))
        token.version += 1
        moved.append((token, old))
    obj.x, obj.y, obj.rotation = x, y, rotation
    obj.version += 1
    return moved


async def explore_moves(
    session: AsyncSession, scene: Scene, moves: list[tuple[Token, list[Point]]]
) -> list[tuple[uuid.UUID, list[int]]]:
    """Grava o caminho dos personagens na névoa (sem commit). Inimigos não exploram."""
    revealed = []
    for token, path in moves:
        if token.character_id is None or token.scene_id != scene.id:
            continue
        cells = await fog_service.explore(session, scene, token.character_id, path)
        if cells:
            revealed.append((token.character_id, cells))
    return revealed
