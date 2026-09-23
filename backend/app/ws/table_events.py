"""Eventos da mesa virtual. O Mestre recebe tudo; cada jogador só o que acontece na cena do seu boneco,
e dos inimigos só o formato público (nome, imagem e estado vago)."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AppState
from app.models import Npc, Room, Scene, Token
from app.models.enums import SessionEventType, Visibility
from app.services import rooms as room_service
from app.services import table as table_service
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


async def scene_upserted(state: AppState, session: AsyncSession, room: Room, scene: Scene) -> None:
    payload = table_service.scene_out(scene, state.media)
    await _to_master(state, room, "scene.upserted", scene=payload)
    await _to(state, room, await table_service.scene_players(session, room, scene.id), "scene.upserted", scene=payload)


async def scene_deleted(
    state: AppState, session: AsyncSession, room: Room, scene_id: uuid.UUID, affected
) -> None:  # noqa: ANN001
    await _to_master(state, room, "scene.deleted", scene_id=str(scene_id))
    for user_id in affected:
        await send_view_reset(state, session, room, user_id)


async def token_upserted(
    state: AppState, session: AsyncSession, room: Room, token: Token, previous_scene_id: uuid.UUID | None = None
) -> None:
    payload = table_service.token_out(token)
    await _to_master(state, room, "token.upserted", token=payload)

    owner = await table_service.owner_of_character(session, room, token.character_id) if token.character_id else None
    moved_scene = previous_scene_id is None or previous_scene_id != token.scene_id
    viewers = set(await table_service.scene_players(session, room, token.scene_id))
    if owner and moved_scene:
        # O dono do personagem passa a ver outra cena: recebe a cena inteira.
        viewers.discard(owner)
        await send_view_reset(state, session, room, owner)
    if token.hidden:
        await _to(state, room, viewers, "token.deleted", token_id=str(token.id))
    else:
        npc = await session.get(Npc, token.npc_id) if token.npc_id else None
        extra = {"npc": table_service.npc_public_out(npc, state.media)} if npc else {}
        await _to(state, room, viewers, "token.upserted", token=payload, **extra)
    if previous_scene_id is not None and previous_scene_id != token.scene_id:
        old_viewers = set(await table_service.scene_players(session, room, previous_scene_id)) - {owner}
        await _to(state, room, old_viewers, "token.deleted", token_id=str(token.id))


async def token_moved(state: AppState, session: AsyncSession, room: Room, token: Token) -> None:
    fields = {"token_id": str(token.id), "x": token.x, "y": token.y, "version": token.version}
    await _to_master(state, room, "token.moved", **fields)
    if not token.hidden:
        await _to(
            state, room, await table_service.scene_players(session, room, token.scene_id), "token.moved", **fields
        )


async def token_deleted(
    state: AppState, session: AsyncSession, room: Room, token_id: uuid.UUID, scene_viewers, owner  # noqa: ANN001
) -> None:
    await _to_master(state, room, "token.deleted", token_id=str(token_id))
    await _to(state, room, set(scene_viewers) - {owner}, "token.deleted", token_id=str(token_id))
    if owner:
        await send_view_reset(state, session, room, owner)


async def npc_upserted(state: AppState, session: AsyncSession, room: Room, npc: Npc) -> None:
    await _to_master(state, room, "npc.upserted", npc=table_service.npc_master_out(npc, state.media))
    viewers = await table_service.npc_viewers(session, room, npc.id)
    await _to(state, room, viewers, "npc.upserted", npc=table_service.npc_public_out(npc, state.media))


async def npc_deleted(
    state: AppState, session: AsyncSession, room: Room, npc_id: uuid.UUID, viewers
) -> None:  # noqa: ANN001
    await _to_master(state, room, "npc.deleted", npc_id=str(npc_id))
    for user_id in viewers:
        await send_view_reset(state, session, room, user_id)


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
