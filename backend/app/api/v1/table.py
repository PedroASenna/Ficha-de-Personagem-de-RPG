"""Mesa virtual do Mestre: cenas com mapa, inimigos e bonecos. Quase tudo é exclusivo do Mestre."""

import asyncio
import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AppState, get_current_user, get_db, get_state
from app.api.v1.characters import level_up_and_announce
from app.core.errors import DomainError, NotFoundError, RateLimitedError
from app.models import Npc, RoomMember, Scene, SceneImage, SceneObject, Token, User
from app.schemas.characters import CharacterOut, LevelUpIn
from app.schemas.table import (
    FogResetIn,
    ImageOut,
    NpcHpIn,
    NpcIn,
    NpcPatch,
    SceneImageBatch,
    SceneImageIn,
    SceneImagePatch,
    SceneIn,
    SceneObjectIn,
    SceneObjectPatch,
    ScenePatch,
    TableView,
    TokenIn,
    TokenPatch,
)
from app.services import characters as character_service
from app.services import fog as fog_service
from app.services import rooms as room_service
from app.services import table as service
from app.services.hp import apply_hp
from app.services.media import ROOM_IMAGE_KINDS, InvalidImageError, new_room_media_key, process_image
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


@router.post("/rooms/{room_id}/characters/{character_id}/level-up", response_model=CharacterOut)
async def master_level_up(
    room_id: uuid.UUID,
    character_id: uuid.UUID,
    data: LevelUpIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """O Mestre sobe o nível de um personagem da mesa (fim da aventura, marco da história...)."""
    room = await _master_room(db, room_id, user)
    seated = await db.scalar(
        select(RoomMember).where(
            RoomMember.room_id == room.id, RoomMember.character_id == character_id, RoomMember.kicked_at.is_(None)
        )
    )
    character = await character_service.get_character(db, character_id) if seated else None
    if character is None:
        raise NotFoundError("Personagem não está nesta mesa.")
    await level_up_and_announce(db, state, user, character, data)
    await db.refresh(character, ["updated_at"])
    return character_service.to_out(
        character_service.pack_for(state.registry, character.ruleset_id), character, state.media
    )


# ---------- imagens ----------


@router.post("/rooms/{room_id}/images", response_model=ImageOut, status_code=status.HTTP_201_CREATED)
async def upload_room_image(
    room_id: uuid.UUID,
    kind: str = Query(pattern="^(" + "|".join(ROOM_IMAGE_KINDS) + ")$"),
    rotation: float = Query(default=0, ge=-360, le=360),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Mapa (até 4096 px), retrato de inimigo (512x512), peça de cenário (até 2048 px, com transparência)
    ou brasão (512 px). `rotation` gira a imagem (graus, sentido horário) antes de gravar. EXIF sempre removido."""
    room = await _master_room(db, room_id, user)
    if not state.limiters.upload.allow(f"upload:{user.id}"):
        raise RateLimitedError("Muitos envios seguidos. Aguarde um pouco.")
    limit = state.settings.max_upload_bytes if kind == "token" else state.settings.max_map_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise DomainError(f"Imagem maior que {limit // (1024 * 1024)} MB.")
    try:
        image = await asyncio.to_thread(process_image, data, kind, rotation)
    except InvalidImageError as exc:
        raise DomainError(str(exc)) from exc
    key = new_room_media_key(room.id, kind, image.extension)
    await state.media.put(key, image.data, image.content_type)
    return ImageOut(key=key, url=state.media.url(key), width=image.width, height=image.height)


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
    geometry = fog_service.geometry(scene)
    fog_before = scene.fog_enabled
    for key, value in changes.items():
        if value is not None or key == "map_key":
            setattr(scene, key, value)
    geometry_changed = fog_service.geometry(scene) != geometry
    if geometry_changed:
        # Mapa ou grade novos: a exploração antiga não se encaixa mais.
        await fog_service.reset(db, scene.id)
    await db.commit()
    await table_events.scene_upserted(
        state, db, room, scene, reset_view=geometry_changed or scene.fog_enabled != fog_before
    )
    if geometry_changed:
        await table_events.fog_reset(state, db, room, scene, None)
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
    keys = [scene.map_key]
    keys += (await db.scalars(select(SceneImage.image_key).where(SceneImage.scene_id == scene.id))).all()
    keys += (await db.scalars(select(SceneObject.image_key).where(SceneObject.scene_id == scene.id))).all()
    await db.delete(scene)
    await db.commit()
    await service.delete_unused_media(db, state.media, keys)
    await table_events.scene_deleted(state, db, room, scene_id, affected)


@router.post("/scenes/{scene_id}/fog/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_fog(
    scene_id: uuid.UUID,
    data: FogResetIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Cobre de novo a cena com névoa (de todos ou de um personagem)."""
    scene, room = await _scene_and_room(db, scene_id, user)
    await fog_service.reset(db, scene.id, data.character_id)
    await db.commit()
    await table_events.fog_reset(state, db, room, scene, data.character_id)


async def _scene_and_room(db: AsyncSession, scene_id: uuid.UUID, user: User):
    scene = await db.get(Scene, scene_id)
    if scene is None:
        raise NotFoundError("Cena não encontrada.")
    return scene, await _master_room(db, scene.room_id, user)


# ---------- peças de cenário ----------


def _apply(target, changes: dict) -> None:  # noqa: ANN001
    for key, value in changes.items():
        setattr(target, key, value)


@router.post("/scenes/{scene_id}/images", status_code=status.HTTP_201_CREATED)
async def add_scene_image(
    scene_id: uuid.UUID,
    data: SceneImageIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Põe uma peça de cenário na cena (a imagem já enviada em /rooms/{id}/images)."""
    scene, room = await _scene_and_room(db, scene_id, user)
    service.check_room_media_key(room, data.image_key)
    z = data.z
    if z is None:
        top = await db.scalar(select(func.max(SceneImage.z)).where(SceneImage.scene_id == scene.id))
        z = min(1000, (top if top is not None else -1) + 1)
    image = SceneImage(room_id=room.id, scene_id=scene.id, version=1, **data.model_dump(exclude={"z"}), z=z)
    db.add(image)
    await db.commit()
    await table_events.image_upserted(state, db, room, image)
    return service.image_out(image, state.media)


@router.patch("/scene-images")
async def update_scene_images(
    data: SceneImageBatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Mexe em várias peças de uma vez (todas da mesma mesa)."""
    images = []
    room = None
    for item in data.items:
        image = await db.get(SceneImage, item.id)
        if image is None:
            raise NotFoundError("Peça de cenário não encontrada.")
        if room is None:
            room = await _master_room(db, image.room_id, user)
        elif image.room_id != room.id:
            raise DomainError("As peças precisam ser da mesma mesa.")
        _apply(image, item.model_dump(exclude_unset=True, exclude_none=True, exclude={"id"}))
        image.version += 1
        images.append(image)
    await db.commit()
    for image in images:
        await table_events.image_upserted(state, db, room, image)
    return [service.image_out(i, state.media) for i in images]


async def _image_and_room(db: AsyncSession, image_id: uuid.UUID, user: User):
    image = await db.get(SceneImage, image_id)
    if image is None:
        raise NotFoundError("Peça de cenário não encontrada.")
    return image, await _master_room(db, image.room_id, user)


@router.patch("/scene-images/{image_id}")
async def update_scene_image(
    image_id: uuid.UUID,
    data: SceneImagePatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    image, room = await _image_and_room(db, image_id, user)
    _apply(image, data.model_dump(exclude_unset=True, exclude_none=True))
    image.version += 1
    await db.commit()
    await table_events.image_upserted(state, db, room, image)
    return service.image_out(image, state.media)


@router.delete("/scene-images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scene_image(
    image_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    image, room = await _image_and_room(db, image_id, user)
    scene_id, key = image.scene_id, image.image_key
    await db.delete(image)
    await db.commit()
    await service.delete_unused_media(db, state.media, [key])
    await table_events.image_deleted(state, db, room, scene_id, image_id)


# ---------- objetos que carregam bonecos ----------


@router.post("/scenes/{scene_id}/objects", status_code=status.HTTP_201_CREATED)
async def add_scene_object(
    scene_id: uuid.UUID,
    data: SceneObjectIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Carroça, barco, jaula...: bonecos soltos em cima dele passam a andar junto."""
    scene, room = await _scene_and_room(db, scene_id, user)
    service.check_room_media_key(room, data.image_key)
    top = await db.scalar(select(func.max(SceneObject.z)).where(SceneObject.scene_id == scene.id))
    obj = SceneObject(
        room_id=room.id,
        scene_id=scene.id,
        version=1,
        z=min(1000, (top if top is not None else -1) + 1),
        **data.model_dump(),
    )
    db.add(obj)
    await db.commit()
    await table_events.object_upserted(state, db, room, obj)
    return service.object_out(obj, state.media)


async def _object_and_room(db: AsyncSession, object_id: uuid.UUID, user: User):
    obj = await db.get(SceneObject, object_id)
    if obj is None:
        raise NotFoundError("Objeto não encontrado.")
    return obj, await _master_room(db, obj.room_id, user)


@router.patch("/scene-objects/{object_id}")
async def update_scene_object(
    object_id: uuid.UUID,
    data: SceneObjectPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    obj, room = await _object_and_room(db, object_id, user)
    changes = data.model_dump(exclude_unset=True)
    if "image_key" in changes:
        service.check_room_media_key(room, changes["image_key"])
    old_key = obj.image_key
    hide_changed = changes.get("hide_occupants") not in (None, obj.hide_occupants)
    x, y, rotation = (changes.pop(k, None) for k in ("x", "y", "rotation"))
    _apply(obj, {k: v for k, v in changes.items() if v is not None or k == "image_key"})
    if x is None and y is None and rotation is None:
        obj.version += 1
        await db.commit()
        await table_events.object_upserted(state, db, room, obj, reset_view=hide_changed)
    else:
        target_x = x if x is not None else obj.x
        target_y = y if y is not None else obj.y
        await table_events.move_object(
            state, db, room, obj, target_x, target_y, rotation if rotation is not None else obj.rotation
        )
        if hide_changed:
            await table_events.reset_players(state, db, room, await service.scene_players(db, room, obj.scene_id))
    if old_key and old_key != obj.image_key:
        await service.delete_unused_media(db, state.media, [old_key])
    return service.object_out(obj, state.media)


@router.delete("/scene-objects/{object_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scene_object(
    object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Apaga o objeto; quem estava dentro fica no mesmo lugar, solto no mapa."""
    obj, room = await _object_and_room(db, object_id, user)
    released = await service.occupants(db, obj)
    for token in released:
        token.container_id = None
        token.version += 1
    scene_id, key, hidden = obj.scene_id, obj.image_key, obj.hide_occupants
    await db.delete(obj)
    await db.commit()
    await service.delete_unused_media(db, state.media, [key])
    await table_events.object_deleted(
        state, db, room, scene_id, object_id, released, reset_view=hidden and bool(released)
    )


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
    token.rotation, token.container_id = data.rotation, None
    revealed = await service.explore_moves(db, scene, [(token, [(token.x, token.y)])])
    await db.commit()
    await table_events.token_upserted(state, db, room, token, previous_scene_id)
    await table_events.fog_revealed(state, db, room, scene, revealed)
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
    old_position = (token.x, token.y)
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    scene = await db.get(Scene, changes.get("scene_id", token.scene_id))
    if scene is None or scene.room_id != room.id:
        raise NotFoundError("Cena não encontrada.")
    if "container_id" in data.model_fields_set:
        if data.container_id is not None:
            await service.container_in_scene(db, room, data.container_id, scene.id)
        token.container_id = data.container_id
    elif scene.id != previous_scene_id:
        token.container_id = None  # mudou de cena: sai da carroça
    was_hidden = token.hidden
    for key, value in changes.items():
        if key != "container_id":
            setattr(token, key, value)
    token.version += 1
    changed_scene = scene.id != previous_scene_id
    path = [(token.x, token.y)] if changed_scene else [old_position, (token.x, token.y)]
    revealed = []
    if changed_scene or old_position != (token.x, token.y):
        revealed = await service.explore_moves(db, scene, [(token, path)])
    await db.commit()
    if was_hidden and not token.hidden and token.scene_id == previous_scene_id:
        previous_scene_id = None  # reaparece: os jogadores da cena recebem como novo
    await table_events.token_upserted(state, db, room, token, previous_scene_id)
    await table_events.fog_revealed(state, db, room, scene, revealed)
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
