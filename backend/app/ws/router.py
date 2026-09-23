import asyncio
import contextlib
import json
import logging
import uuid
from dataclasses import dataclass

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy import select

from app.api.deps import AppState
from app.core.errors import DomainError, ForbiddenError, NotFoundError, RateLimitedError
from app.core.security import InvalidTokenError, decode_access_token
from app.models import Character, RoomMember, User
from app.models.enums import RoomRole, Visibility
from app.schemas.rooms import EventOut
from app.services import characters as character_service
from app.services import dice
from app.services import rooms as room_service
from app.ws.events import announce_hp_change, announce_roll, roll_summary, rooms_with_character
from app.ws.manager import Connection
from app.ws.protocol import (
    CLOSE_FORBIDDEN,
    CLOSE_NOT_FOUND,
    CLOSE_UNAUTHORIZED,
    AuthMsg,
    HpChangeMsg,
    PingMsg,
    RollRequestMsg,
    client_message_adapter,
    error_message,
    server_message,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@dataclass(frozen=True)
class RoomContext:
    room_id: uuid.UUID
    ruleset_id: str
    master_id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    role: RoomRole


async def _close(websocket: WebSocket, code: int) -> None:
    with contextlib.suppress(Exception):
        await websocket.close(code=code)


async def _authenticate(websocket: WebSocket, state: AppState) -> uuid.UUID | None:
    # O token vai na 1ª mensagem, nunca na URL (URLs acabam em logs de proxy/load balancer).
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=state.settings.ws_auth_timeout_seconds)
        auth = AuthMsg.model_validate_json(raw)
        return decode_access_token(state.settings, auth.token)
    except (TimeoutError, ValidationError, InvalidTokenError, WebSocketDisconnect):
        return None


@router.websocket("/ws/rooms/{pin}")
async def room_socket(websocket: WebSocket, pin: str) -> None:
    state: AppState = websocket.app.state.ctx
    await websocket.accept()
    user_id = await _authenticate(websocket, state)
    if user_id is None:
        await _close(websocket, CLOSE_UNAUTHORIZED)
        return

    async with state.db.sessionmaker() as session:
        user = await session.get(User, user_id)
        if user is None or user.deleted_at is not None:
            await _close(websocket, CLOSE_UNAUTHORIZED)
            return
        try:
            room = await room_service.get_open_room_by_pin(session, pin)
        except NotFoundError:
            await _close(websocket, CLOSE_NOT_FOUND)
            return
        member = await room_service.get_member(session, room.id, user.id)
        if member is None or member.kicked_at is not None:
            await _close(websocket, CLOSE_FORBIDDEN)
            return
        ctx = RoomContext(room.id, room.ruleset_id, room.master_id, user.id, user.display_name, member.role)
        manager = state.broadcaster.manager
        online = manager.online_user_ids(room.id) | {user.id}
        room_view = await room_service.room_out(session, room, user.id, state.registry, state.media, online)
        events = await room_service.list_events(session, room, member, limit=50)
        welcome = server_message(
            "welcome",
            room=room_view.model_dump(mode="json"),
            log=[EventOut.model_validate(e).model_dump(mode="json") for e in events],
        )

    conn = Connection(websocket=websocket, user_id=ctx.user_id, role=ctx.role)
    manager.add(ctx.room_id, conn)
    try:
        await websocket.send_json(welcome)
        await state.broadcaster.publish(
            ctx.room_id,
            server_message("presence", user_id=str(ctx.user_id), display_name=ctx.display_name, online=True),
        )
        while True:
            text = await websocket.receive_text()
            await _dispatch(state, ctx, websocket, text)
    except WebSocketDisconnect:
        pass
    finally:
        manager.remove(ctx.room_id, conn)
        if ctx.user_id not in manager.online_user_ids(ctx.room_id):
            with contextlib.suppress(Exception):
                await state.broadcaster.publish(
                    ctx.room_id,
                    server_message("presence", user_id=str(ctx.user_id), display_name=ctx.display_name, online=False),
                )


async def _dispatch(state: AppState, ctx: RoomContext, websocket: WebSocket, text: str) -> None:
    ref = None
    try:
        data = json.loads(text)
        ref = data.get("id") if isinstance(data, dict) else None
        msg = client_message_adapter.validate_python(data)
        if isinstance(msg, PingMsg):
            await websocket.send_json(server_message("pong"))
        elif isinstance(msg, RollRequestMsg):
            await _handle_roll(state, ctx, msg)
        elif isinstance(msg, HpChangeMsg):
            await _handle_hp(state, ctx, msg)
    except (json.JSONDecodeError, ValidationError):
        await websocket.send_json(error_message("bad_request", "Mensagem inválida.", ref))
    except dice.NotationError as exc:
        await websocket.send_json(error_message("invalid_notation", str(exc), ref))
    except DomainError as exc:
        await websocket.send_json(error_message(exc.code, exc.message, ref))
    except WebSocketDisconnect:
        raise
    except Exception:
        logger.exception("Erro ao processar mensagem do WebSocket")
        await websocket.send_json(error_message("internal", "Erro inesperado. Tente de novo.", ref))


async def _room_character(session, ctx: RoomContext, character_id: uuid.UUID) -> Character:
    """Personagem vinculado a um membro ativo desta sala."""
    linked = await session.scalar(
        select(RoomMember).where(
            RoomMember.room_id == ctx.room_id,
            RoomMember.character_id == character_id,
            RoomMember.kicked_at.is_(None),
        )
    )
    character = await character_service.get_character(session, character_id) if linked else None
    if character is None:
        raise NotFoundError("Personagem não está nesta mesa.")
    return character


async def _handle_roll(state: AppState, ctx: RoomContext, msg: RollRequestMsg) -> None:
    if not state.limiters.roll.allow(f"roll:{ctx.user_id}"):
        raise RateLimitedError("Calma! Muitas rolagens seguidas.")
    expression = dice.parse(msg.notation)
    async with state.db.sessionmaker() as session:
        character = None
        if msg.character_id:
            character = await _room_character(session, ctx, msg.character_id)
            if character.owner_id != ctx.user_id and ctx.role != RoomRole.MASTER:
                raise ForbiddenError("Você só pode rolar pelo seu personagem.")
        result = dice.roll(expression)
        outcome = dice.classify(result, state.registry.outcome_rules(ctx.ruleset_id))
        payload = {
            "request_id": msg.id,
            "label": msg.label,
            "roll": result.to_dict(),
            "outcome": outcome.to_dict(),
            "actor": {"user_id": str(ctx.user_id), "display_name": ctx.display_name},
            "character": {"id": str(character.id), "name": character.name} if character else None,
            "summary": roll_summary(
                ctx.display_name,
                character.name if character else None,
                msg.label,
                result.expression.canonical(),
                result.total,
                outcome.tier,
            ),
        }
        await announce_roll(
            session,
            state.broadcaster,
            room_id=ctx.room_id,
            master_id=ctx.master_id,
            actor_id=ctx.user_id,
            character_id=character.id if character else None,
            visibility=Visibility(msg.visibility),
            payload=payload,
        )


async def _handle_hp(state: AppState, ctx: RoomContext, msg: HpChangeMsg) -> None:
    if not state.limiters.hp.allow(f"hp:{ctx.user_id}"):
        raise RateLimitedError("Muitas alterações de PV seguidas.")
    async with state.db.sessionmaker() as session:
        character = await _room_character(session, ctx, msg.character_id)
        # Jogador altera o próprio personagem; o Mestre altera qualquer um da mesa.
        if character.owner_id != ctx.user_id and ctx.role != RoomRole.MASTER:
            raise ForbiddenError("Só o dono do personagem ou o Mestre podem alterar os PV.")
        transition = character_service.apply_hp_change(character, msg.delta, msg.kind, msg.expected_version)
        rooms = await _rooms_for(session, character.id, ctx.room_id)
        await announce_hp_change(
            session,
            state.broadcaster,
            room_ids=rooms,
            actor_id=ctx.user_id,
            actor_name=ctx.display_name,
            character=character,
            transition=transition,
        )


async def _rooms_for(session, character_id: uuid.UUID, current_room: uuid.UUID) -> list[uuid.UUID]:
    ids = [r.id for r in await rooms_with_character(session, character_id)]
    return ids if current_room in ids else [current_room, *ids]
