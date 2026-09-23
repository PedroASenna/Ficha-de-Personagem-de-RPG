"""Mesa virtual do Mestre: cenas com mapa, inimigos e bonecos. Quase tudo é exclusivo do Mestre."""

import asyncio
import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AppState, get_current_user, get_db, get_state
from app.core.errors import DomainError, NotFoundError, RateLimitedError
from app.models import Npc, RoomMember, Scene, Token, User
from app.schemas.characters import CharacterOut
from app.schemas.table import (
    ImageOut,
    NpcHpIn,
    NpcIn,
    NpcPatch,
    SceneIn,
    ScenePatch,
    TableView,
    TokenIn,
    TokenPatch,
)
from app.services import characters as character_service
from app.services import rooms as room_service
from app.services import table as service
from app.services.hp import apply_hp
from app.services.media import (
    InvalidImageError,
    new_room_media_key,
    process_map,
    process_portrait,
)
from app.ws import table_events

router = APIRouter(tags=["mesa virtual"])


async def _master_room(db: AsyncSession, room_id: uuid.UUID, user: User):
    room = await service.get_room(db, room_id)
    service.require_master(room, user)
    return room


# ---------- visão ----------


@router.get("/rooms/{room_id}/table", response_model=TableView)
async def get_table(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Mestre: cenas, bonecos (inclusive escondidos) e inimigos completos. Jogador: só a cena do seu boneco."""
    room = await service.get_room(db, room_id)
    member = await room_service.require_member(db, room, user)
    return await service.table_view(db, room, member, state.media)


@router.get("/rooms/{room_id}/characters/{character_id}", response_model=CharacterOut)
async def master_character_sheet(
    room_id: uuid.UUID,
    character_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Ficha completa de um personagem da mesa (para o Mestre clicar no boneco e ver tudo)."""
    room = await _master_room(db, room_id, user)
    seated = await db.scalar(
        select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.character_id == character_id)
    )
    character = await character_service.get_character(db, character_id) if seated else None
    if character is None:
        raise NotFoundError("Personagem não está nesta mesa.")
    return character_service.to_out(
        character_service.pack_for(state.registry, character.ruleset_id), character, state.media
    )


# ---------- imagens ----------


@router.post("/rooms/{room_id}/images", response_model=ImageOut, status_code=status.HTTP_201_CREATED)
async def upload_room_image(
    room_id: uuid.UUID,
    kind: str = Query(pattern="^(map|token)$"),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Mapa de cena (até 4096 px no lado maior) ou retrato de inimigo (512x512). EXIF sempre removido."""
    room = await _master_room(db, room_id, user)
    if not state.limiters.upload.allow(f"upload:{user.id}"):
        raise RateLimitedError("Muitos envios seguidos. Aguarde um pouco.")
    limit = state.settings.max_map_upload_bytes if kind == "map" else state.settings.max_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise DomainError(f"Imagem maior que {limit // (1024 * 1024)} MB.")
    try:
        if kind == "map":
            processed, width, height = await asyncio.to_thread(process_map, data)
        else:
            processed, width, height = await asyncio.to_thread(process_portrait, data), 512, 512
    except InvalidImageError as exc:
        raise DomainError(str(exc)) from exc
    key = new_room_media_key(room.id, kind)
    await state.media.put(key, processed, "image/jpeg")
    return ImageOut(key=key, url=state.media.url(key), width=width, height=height)


# ---------- cenas ----------


@router.post("/rooms/{room_id}/scenes", status_code=status.HTTP_201_CREATED)
async def create_scene(
    room_id: uuid.UUID,
    data: SceneIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    room = await _master_room(db, room_id, user)
    service.check_room_media_key(room, data.map_key)
    order = await db.scalar(select(func.coalesce(func.max(Scene.sort_order), -1)).where(Scene.room_id == room.id))
    scene = Scene(room_id=room.id, sort_order=order + 1, **data.model_dump())
    db.add(scene)
    await db.commit()
    await table_events.scene_upserted(state, db, room, scene)
    return service.scene_out(scene, state.media)


@router.patch("/scenes/{scene_id}")
async def update_scene(
    scene_id: uuid.UUID,
    data: ScenePatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    scene = await db.get(Scene, scene_id)
    if scene is None:
        raise NotFoundError("Cena não encontrada.")
    room = await _master_room(db, scene.room_id, user)
    changes = data.model_dump(exclude_unset=True)
    if "map_key" in changes:
        service.check_room_media_key(room, changes["map_key"])
    for key, value in changes.items():
        if value is not None or key == "map_key":
            setattr(scene, key, value)
    await db.commit()
    await table_events.scene_upserted(state, db, room, scene)
    return service.scene_out(scene, state.media)


@router.delete("/scenes/{scene_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scene(
    scene_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    scene = await db.get(Scene, scene_id)
    if scene is None:
        raise NotFoundError("Cena não encontrada.")
    room = await _master_room(db, scene.room_id, user)
    affected = await service.scene_players(db, room, scene.id)
    map_key = scene.map_key
    await db.delete(scene)
    await db.commit()
    if map_key:
        await state.media.delete(map_key)
    await table_events.scene_deleted(state, db, room, scene_id, affected)


# ---------- inimigos / NPCs ----------


@router.post("/rooms/{room_id}/npcs", status_code=status.HTTP_201_CREATED)
async def create_npcs(
    room_id: uuid.UUID,
    data: NpcIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Cria um inimigo, ou vários numerados de uma vez ("Goblin 1", "Goblin 2"...)."""
    room = await _master_room(db, room_id, user)
    service.check_room_media_key(room, data.portrait_key)
    created = []
    for i in range(data.count):
        name = data.name.strip() if data.count == 1 else f"{data.name.strip()} {i + 1}"
        npc = Npc(
            room_id=room.id,
            name=name[:60],
            portrait_key=data.portrait_key,
            hp_max=data.hp_max,
            hp_current=data.hp_max,
            hp_temp=0,
            armor_class=data.armor_class,
            attributes=data.attributes,
            notes=data.notes,
            version=1,
        )
        db.add(npc)
        created.append(npc)
    await db.commit()
    for npc in created:
        await table_events.npc_upserted(state, db, room, npc)
    return [service.npc_master_out(n, state.media) for n in created]


async def _npc_and_room(db: AsyncSession, npc_id: uuid.UUID, user: User):
    npc = await db.get(Npc, npc_id)
    if npc is None:
        raise NotFoundError("Inimigo não encontrado.")
    return npc, await _master_room(db, npc.room_id, user)


@router.patch("/npcs/{npc_id}")
async def update_npc(
    npc_id: uuid.UUID,
    data: NpcPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    npc, room = await _npc_and_room(db, npc_id, user)
    changes = data.model_dump(exclude_unset=True)
    if "portrait_key" in changes:
        service.check_room_media_key(room, changes["portrait_key"])
    for key, value in changes.items():
        if value is not None or key == "portrait_key":
            setattr(npc, key, value)
    npc.hp_current = min(npc.hp_current, npc.hp_max)
    npc.version += 1
    await db.commit()
    await table_events.npc_upserted(state, db, room, npc)
    return service.npc_master_out(npc, state.media)


@router.post("/npcs/{npc_id}/hp")
async def change_npc_hp(
    npc_id: uuid.UUID,
    data: NpcHpIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    npc, room = await _npc_and_room(db, npc_id, user)
    transition = apply_hp(npc, data.delta, data.kind, data.expected_version)
    await table_events.npc_hp_changed(state, db, room, npc, transition, user.id, user.display_name)
    return service.npc_master_out(npc, state.media)


@router.delete("/npcs/{npc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_npc(
    npc_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    npc, room = await _npc_and_room(db, npc_id, user)
    viewers = await service.npc_viewers(db, room, npc.id)
    await db.delete(npc)
    await db.commit()
    await table_events.npc_deleted(state, db, room, npc_id, viewers)


# ---------- bonecos ----------


@router.post("/rooms/{room_id}/tokens", status_code=status.HTTP_201_CREATED)
async def place_token(
    room_id: uuid.UUID,
    data: TokenIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Coloca um boneco na cena. Personagem que já tem boneco na mesa é movido para cá."""
    room = await _master_room(db, room_id, user)
    scene = await db.get(Scene, data.scene_id)
    if scene is None or scene.room_id != room.id:
        raise NotFoundError("Cena não encontrada.")
    previous_scene_id = None
    if data.character_id:
        seated = await db.scalar(
            select(RoomMember.user_id).where(
                RoomMember.room_id == room.id,
                RoomMember.character_id == data.character_id,
                RoomMember.kicked_at.is_(None),
            )
        )
        if seated is None:
            raise DomainError("Esse personagem não está sentado nesta mesa.")
        token = await db.scalar(select(Token).where(Token.room_id == room.id, Token.character_id == data.character_id))
    else:
        npc = await db.get(Npc, data.npc_id)
        if npc is None or npc.room_id != room.id:
            raise NotFoundError("Inimigo não encontrado.")
        token = None
    if token is None:
        token = Token(room_id=room.id, character_id=data.character_id, npc_id=data.npc_id, version=1, z=0)
        db.add(token)
    else:
        previous_scene_id = token.scene_id
        token.version += 1
    token.scene_id, token.x, token.y, token.size, token.hidden = scene.id, data.x, data.y, data.size, data.hidden
    await db.commit()
    await table_events.token_upserted(state, db, room, token, previous_scene_id)
    return service.token_out(token)


async def _token_and_room(db: AsyncSession, token_id: uuid.UUID, user: User):
    token = await db.get(Token, token_id)
    if token is None:
        raise NotFoundError("Boneco não encontrado.")
    return token, await _master_room(db, token.room_id, user)


@router.patch("/tokens/{token_id}")
async def update_token(
    token_id: uuid.UUID,
    data: TokenPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Esconder/mostrar, tamanho, posição ou mudar de cena (grupo que se separou)."""
    token, room = await _token_and_room(db, token_id, user)
    previous_scene_id = token.scene_id
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    if "scene_id" in changes:
        scene = await db.get(Scene, changes["scene_id"])
        if scene is None or scene.room_id != room.id:
            raise NotFoundError("Cena não encontrada.")
    was_hidden = token.hidden
    for key, value in changes.items():
        setattr(token, key, value)
    token.version += 1
    await db.commit()
    if was_hidden and not token.hidden and token.scene_id == previous_scene_id:
        previous_scene_id = None  # reaparece: os jogadores da cena recebem como novo
    await table_events.token_upserted(state, db, room, token, previous_scene_id)
    return service.token_out(token)


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_token(
    token_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    token, room = await _token_and_room(db, token_id, user)
    viewers = await service.scene_players(db, room, token.scene_id)
    owner = await service.owner_of_character(db, room, token.character_id) if token.character_id else None
    await db.delete(token)
    await db.commit()
    await table_events.token_deleted(state, db, room, token_id, viewers, owner)
