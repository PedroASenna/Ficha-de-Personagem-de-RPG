"""Eventos da mesa virtual. O Mestre recebe tudo; cada jogador só o que acontece na cena do seu boneco,
dos inimigos só o formato público (nome, imagem e estado vago) e da névoa só o que ele explorou."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AppState
from app.models import Npc, Room, Scene, SceneImage, SceneObject, Token
from app.models.enums import SessionEventType, Visibility
from app.services import rooms as room_service
from app.services import table as table_service
from app.services import world as world_service
from app.services.hp import CONDITION_LABEL, condition
from app.ws.events import hp_summary
from app.ws.protocol import server_message


def _ids(users: list[uuid.UUID] | set[uuid.UUID]) -> list[str]:
    return [str(u) for u in users]


async def _to_master(state: AppState, room: Room, msg_type: str, **fields: Any) -> None:
    await state.broadcaster.publish(room.id, server_message(msg_type, **fields), [str(room.master_id)])


async def _to(state: AppState, room: Room, users, msg_type: str, **fields: Any) -> None:  # noqa: ANN001
    if users:
        await state.broadcaster.publish(room.id, server_message(msg_type, **fields), _ids(users))


async def party_updated(state: AppState, session: AsyncSession, room: Room) -> None:
    """Alguém entrou, trocou de personagem ou saiu: todos recebem o grupo atualizado."""
    party = await table_service.party_out(session, room, state.media)
    await state.broadcaster.publish(room.id, server_message("party.updated", party=party))


async def send_view_reset(state: AppState, session: AsyncSession, room: Room, user_id: uuid.UUID) -> None:
    """Manda a visão completa da cena para um jogador (ex.: o boneco dele mudou de cena)."""
    member = await room_service.get_member(session, room.id, user_id)
    if member is None or member.kicked_at is not None:
        return
    view = await table_service.table_view(session, room, member, state.media)
    await _to(state, room, [user_id], "view.reset", table=view)


async def reset_players(state: AppState, session: AsyncSession, room: Room, users) -> None:  # noqa: ANN001
    for user_id in users:
        await send_view_reset(state, session, room, user_id)


# ---------- cenas ----------


async def scene_upserted(
    state: AppState, session: AsyncSession, room: Room, scene: Scene, *, reset_view: bool = False
) -> None:
    """`reset_view`: a mudança altera o que os jogadores enxergam (ex.: névoa ligada), então recebem tudo de novo."""
    payload = table_service.scene_out(scene, state.media)
    await _to_master(state, room, "scene.upserted", scene=payload)
    players = await table_service.scene_players(session, room, scene.id)
    if reset_view:
        await reset_players(state, session, room, players)
    else:
        await _to(state, room, players, "scene.upserted", scene=payload)


async def scene_deleted(
    state: AppState, session: AsyncSession, room: Room, scene_id: uuid.UUID, affected
) -> None:  # noqa: ANN001
    await _to_master(state, room, "scene.deleted", scene_id=str(scene_id))
    await reset_players(state, session, room, affected)


# ---------- bonecos ----------


async def _audience(
    session: AsyncSession, room: Room, token: Token
) -> tuple[dict[uuid.UUID, uuid.UUID], SceneObject | None]:
    audience = await table_service.scene_audience(session, room, token.scene_id)
    container = await session.get(SceneObject, token.container_id) if token.container_id else None
    return audience, container


async def token_upserted(
    state: AppState, session: AsyncSession, room: Room, token: Token, previous_scene_id: uuid.UUID | None = None
) -> None:
    payload = table_service.token_out(token)
    await _to_master(state, room, "token.upserted", token=payload)

    owner = await table_service.owner_of_character(session, room, token.character_id) if token.character_id else None
    moved_scene = previous_scene_id is None or previous_scene_id != token.scene_id
    audience, container = await _audience(session, room, token)
    if owner and moved_scene:
        # O dono do personagem passa a ver outra cena: recebe a cena inteira.
        audience.pop(owner, None)
        await send_view_reset(state, session, room, owner)
    see = [u for u, cid in audience.items() if table_service.token_visible(token, container, cid)]
    blind = [u for u in audience if u not in see]
    await _to(state, room, blind, "token.deleted", token_id=str(token.id))
    if see:
        npc = await session.get(Npc, token.npc_id) if token.npc_id else None
        extra = {"npc": table_service.npc_public_out(npc, state.media)} if npc else {}
        await _to(state, room, see, "token.upserted", token=payload, **extra)
    if previous_scene_id is not None and previous_scene_id != token.scene_id:
        old_viewers = set(await table_service.scene_players(session, room, previous_scene_id)) - {owner}
        await _to(state, room, old_viewers, "token.deleted", token_id=str(token.id))


async def token_moved(state: AppState, session: AsyncSession, room: Room, token: Token) -> None:
    fields = {"token_id": str(token.id), "x": token.x, "y": token.y, "version": token.version}
    await _to_master(state, room, "token.moved", **fields)
    audience, container = await _audience(session, room, token)
    see = [u for u, cid in audience.items() if table_service.token_visible(token, container, cid)]
    await _to(state, room, see, "token.moved", **fields)


async def token_deleted(
    state: AppState, session: AsyncSession, room: Room, token_id: uuid.UUID, scene_viewers, owner  # noqa: ANN001
) -> None:
    await _to_master(state, room, "token.deleted", token_id=str(token_id))
    await _to(state, room, set(scene_viewers) - {owner}, "token.deleted", token_id=str(token_id))
    if owner:
        await send_view_reset(state, session, room, owner)


# ---------- peças de cenário e objetos ----------


async def image_upserted(state: AppState, session: AsyncSession, room: Room, image: SceneImage) -> None:
    payload = table_service.image_out(image, state.media)
    await _to_master(state, room, "image.upserted", image=payload)
    await _to(
        state, room, await table_service.scene_players(session, room, image.scene_id), "image.upserted", image=payload
    )


async def image_deleted(
    state: AppState, session: AsyncSession, room: Room, scene_id: uuid.UUID, image_id: uuid.UUID
) -> None:
    await _to_master(state, room, "image.deleted", image_id=str(image_id))
    await _to(
        state,
        room,
        await table_service.scene_players(session, room, scene_id),
        "image.deleted",
        image_id=str(image_id),
    )


def _moved(tokens: list[Token]) -> list[dict[str, Any]]:
    return [{"token_id": str(t.id), "x": t.x, "y": t.y, "version": t.version} for t in tokens]


async def object_upserted(
    state: AppState,
    session: AsyncSession,
    room: Room,
    obj: SceneObject,
    moved: list[Token] | None = None,
    *,
    reset_view: bool = False,
) -> None:
    """Objeto criado/alterado/movido. `moved` = ocupantes que andaram junto (cada jogador recebe só os que vê).

    `reset_view`: mudou quem os jogadores enxergam dentro dele (esconder/mostrar ocupantes).
    """
    payload = table_service.object_out(obj, state.media)
    moved = moved or []
    await _to_master(state, room, "object.upserted", object=payload, tokens=_moved(moved))
    audience = await table_service.scene_audience(session, room, obj.scene_id)
    if reset_view:
        await reset_players(state, session, room, audience)
        return
    groups: dict[tuple[str, ...], list[uuid.UUID]] = {}
    for user_id, character_id in audience.items():
        visible = tuple(str(t.id) for t in moved if table_service.token_visible(t, obj, character_id))
        groups.setdefault(visible, []).append(user_id)
    for visible, users in groups.items():
        tokens = _moved([t for t in moved if str(t.id) in visible])
        await _to(state, room, users, "object.upserted", object=payload, tokens=tokens)


async def move_object(
    state: AppState, session: AsyncSession, room: Room, obj: SceneObject, x: float, y: float, rotation: float
) -> None:
    """Move/gira o objeto levando os ocupantes; o caminho deles entra na névoa. Faz commit e publica."""
    scene = await session.get(Scene, obj.scene_id)
    moved = table_service.carry(obj, await table_service.occupants(session, obj), x, y, rotation)
    revealed = await table_service.explore_moves(session, scene, [(t, [old, (t.x, t.y)]) for t, old in moved])
    await session.commit()
    await object_upserted(state, session, room, obj, [t for t, _ in moved])
    await fog_revealed(state, session, room, scene, revealed)


async def object_deleted(
    state: AppState,
    session: AsyncSession,
    room: Room,
    scene_id: uuid.UUID,
    object_id: uuid.UUID,
    released: list[Token],
    *,
    reset_view: bool,
) -> None:
    await _to_master(state, room, "object.deleted", object_id=str(object_id))
    for token in released:
        await _to_master(state, room, "token.upserted", token=table_service.token_out(token))
    players = await table_service.scene_players(session, room, scene_id)
    if reset_view:
        # Quem estava escondido dentro volta a aparecer.
        await reset_players(state, session, room, players)
    else:
        await _to(state, room, players, "object.deleted", object_id=str(object_id))


# ---------- névoa de guerra ----------


async def fog_revealed(
    state: AppState, session: AsyncSession, room: Room, scene: Scene, revealed: list[tuple[uuid.UUID, list[int]]]
) -> None:
    """Células recém-exploradas: o Mestre recebe de todos; cada jogador, só as do próprio personagem."""
    for character_id, cells in revealed:
        fields = {"scene_id": str(scene.id), "character_id": str(character_id), "cells": cells}
        await _to_master(state, room, "fog.revealed", **fields)
        if scene.fog_enabled:
            owner = await table_service.owner_of_character(session, room, character_id)
            if owner and owner != room.master_id:
                await _to(state, room, [owner], "fog.revealed", **fields)


async def fog_reset(
    state: AppState, session: AsyncSession, room: Room, scene: Scene, character_id: uuid.UUID | None
) -> None:
    fields = {"scene_id": str(scene.id), "character_id": str(character_id) if character_id else None}
    await _to_master(state, room, "fog.reset", **fields)
    audience = await table_service.scene_audience(session, room, scene.id)
    targets = [u for u, cid in audience.items() if character_id is None or cid == character_id]
    await _to(state, room, targets, "fog.reset", **fields)


# ---------- inimigos ----------


async def npc_upserted(state: AppState, session: AsyncSession, room: Room, npc: Npc) -> None:
    await _to_master(state, room, "npc.upserted", npc=table_service.npc_master_out(npc, state.media))
    viewers = await table_service.npc_viewers(session, room, npc.id)
    await _to(state, room, viewers, "npc.upserted", npc=table_service.npc_public_out(npc, state.media))


async def npc_deleted(
    state: AppState, session: AsyncSession, room: Room, npc_id: uuid.UUID, viewers
) -> None:  # noqa: ANN001
    await _to_master(state, room, "npc.deleted", npc_id=str(npc_id))
    await reset_players(state, session, room, viewers)


async def npc_hp_changed(
    state: AppState,
    session: AsyncSession,
    room: Room,
    npc: Npc,
    transition: dict[str, Any],
    actor_id: uuid.UUID,
    actor_name: str,
) -> None:
    """Dano/cura num inimigo: números só para o Mestre (log secreto); jogadores veem o estado mudar."""
    state_key = condition(npc.hp_current, npc.hp_max)
    payload = {
        **transition,
        "npc_id": str(npc.id),
        "npc": {"id": str(npc.id), "name": npc.name},
        "actor": {"user_id": str(actor_id), "display_name": actor_name},
        "condition": state_key,
        "condition_label": CONDITION_LABEL[state_key],
        "summary": hp_summary(npc.name, transition),
    }
    event = await room_service.record_event(
        session, room.id, actor_id, SessionEventType.HP_CHANGE, payload, visibility=Visibility.MASTER_ONLY
    )
    await session.commit()
    await _to_master(state, room, "npc.hp.changed", event_id=event.id, **payload)
    viewers = await table_service.npc_viewers(session, room, npc.id)
    await _to(state, room, viewers, "npc.upserted", npc=table_service.npc_public_out(npc, state.media))


# ---------- mapa-múndi ----------


async def world_updated(state: AppState, session: AsyncSession, room: Room) -> None:
    """Mapa-múndi, nações, facções ou relações mudaram: o Mestre recebe tudo; os jogadores, o revelado."""
    master_view = await world_service.world_view(session, room, state.media, master=True)
    await _to_master(state, room, "world.updated", world=master_view)
    players = await world_service.player_ids(session, room)
    if players:
        public = await world_service.world_view(session, room, state.media, master=False)
        await _to(state, room, players, "world.updated", world=public)
