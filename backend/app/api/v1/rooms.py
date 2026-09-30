import uuid

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AppState, get_current_user, get_db, get_state
from app.core.errors import JoinPendingError, NotFoundError, RateLimitedError
from app.core.origin import is_remote
from app.models import Room, RoomJoinRequest, RoomMember, User
from app.models.enums import RoomStatus
from app.schemas.rooms import (
    EventOut,
    JoinRequestOut,
    JoinStatusOut,
    KickIn,
    RoomCreate,
    RoomJoin,
    RoomOut,
    RoomPatch,
    SetCharacterIn,
)
from app.services import rooms as service
from app.ws import table_events
from app.ws.protocol import server_message

router = APIRouter(prefix="/rooms", tags=["salas"])


async def _room(db: AsyncSession, room_id: uuid.UUID) -> Room:
    room = await db.get(Room, room_id)
    if room is None:
        raise NotFoundError("Sala não encontrada.")
    return room


async def _view(db: AsyncSession, state: AppState, room: Room, user: User) -> RoomOut:
    online = state.broadcaster.manager.online_user_ids(room.id)
    return await service.room_out(db, room, user.id, state.registry, state.media, online)


@router.post("", response_model=RoomOut, status_code=status.HTTP_201_CREATED)
async def create_room(
    data: RoomCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """O Mestre escolhe o sistema de regras aqui; ele fica fixo durante toda a sala."""
    approval = data.require_approval if data.require_approval is not None else state.remote.enabled
    room = await service.create_room(
        db, user, data.name, data.ruleset_id, data.max_players, state.registry, require_approval=approval
    )
    return await _view(db, state, room, user)


@router.get("", response_model=list[RoomOut])
async def my_rooms(
    include_archived: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Mesas abertas em que participo; com include_archived, também as campanhas arquivadas que mestro."""
    visible = Room.status == RoomStatus.OPEN
    if include_archived:
        visible = visible | (Room.master_id == user.id)
    rooms = await db.scalars(
        select(Room)
        .join(RoomMember, RoomMember.room_id == Room.id)
        .where(RoomMember.user_id == user.id, RoomMember.kicked_at.is_(None), visible)
        .order_by(Room.last_activity_at.desc())
    )
    return [await _view(db, state, room, user) for room in rooms.all()]


@router.post("/join", response_model=RoomOut)
async def join_room(
    data: RoomJoin,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Entra pelo PIN. Se a mesa pede aprovação, responde 409 ``join_pending`` e o app vai para a sala de
    espera (``GET /rooms/join-status``) até o Mestre aceitar; recusado, 403 ``join_denied``."""
    # Limite contra força bruta de PIN (32^6 combinações, mas nunca custa travar).
    if not state.limiters.join_pin.allow(f"join:{user.id}"):
        raise RateLimitedError("Muitas tentativas de PIN. Aguarde um minuto.")
    result = await service.join_room(
        db, user, data.pin, data.character_id, remote=is_remote(request.scope, state.settings)
    )
    if isinstance(result, RoomJoinRequest):
        room = await _room(db, result.room_id)
        await table_events.join_requests(state, db, room)
        raise JoinPendingError(f"Pedido enviado. Espere o Mestre de “{room.name}” aceitar sua entrada.")
    await table_events.party_updated(state, db, result)
    return await _view(db, state, result, user)


@router.get("/join-status", response_model=JoinStatusOut)
async def join_status(
    pin: str = Query(min_length=6, max_length=6),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Sala de espera: o Mestre já aceitou? (com a mesa, quando aceitou)"""
    status_, room = await service.join_status(db, user, pin.strip().upper())
    view = await _view(db, state, room, user) if status_ == "approved" else None
    return JoinStatusOut(status=status_, room=view)


@router.get("/{room_id}", response_model=RoomOut)
async def read_room(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    room = await _room(db, room_id)
    await service.require_member(db, room, user)
    return await _view(db, state, room, user)


@router.patch("/{room_id}", response_model=RoomOut)
async def update_room(
    room_id: uuid.UUID,
    data: RoomPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    room = await _room(db, room_id)
    if data.require_approval is not None:
        await service.set_require_approval(db, room, user, data.require_approval)
    else:
        await service.require_member(db, room, user)
    return await _view(db, state, room, user)


@router.get("/{room_id}/requests", response_model=list[JoinRequestOut])
async def join_requests(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Quem está esperando o Mestre aceitar a entrada."""
    return await service.list_requests(db, await _room(db, room_id), user)


@router.post("/{room_id}/requests/{user_id}/approve", response_model=RoomOut)
async def approve_request(
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    room = await _room(db, room_id)
    await service.approve_request(db, room, user, user_id)
    await table_events.join_requests(state, db, room)
    await table_events.party_updated(state, db, room)
    return await _view(db, state, room, user)


@router.post("/{room_id}/requests/{user_id}/deny", response_model=RoomOut)
async def deny_request(
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    room = await _room(db, room_id)
    await service.deny_request(db, room, user, user_id)
    await table_events.join_requests(state, db, room)
    return await _view(db, state, room, user)


@router.put("/{room_id}/character", response_model=RoomOut)
async def set_character(
    room_id: uuid.UUID,
    data: SetCharacterIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    room = await _room(db, room_id)
    await service.set_character(db, room, user, data.character_id)
    await table_events.party_updated(state, db, room)
    return await _view(db, state, room, user)


@router.get("/{room_id}/events", response_model=list[EventOut])
async def room_events(
    room_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    before_id: int | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Log da sessão. O Mestre vê tudo; jogadores veem eventos públicos e os próprios."""
    room = await _room(db, room_id)
    member = await service.require_member(db, room, user)
    return await service.list_events(db, room, member, limit=limit, before_id=before_id)


@router.post("/{room_id}/kick", status_code=status.HTTP_204_NO_CONTENT)
async def kick_player(
    room_id: uuid.UUID,
    data: KickIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    room = await _room(db, room_id)
    await service.kick(db, room, user, data.user_id)
    await state.broadcaster.publish(room.id, server_message("member.kicked", user_id=str(data.user_id)))
    await table_events.party_updated(state, db, room)


@router.post("/{room_id}/close", status_code=status.HTTP_204_NO_CONTENT)
async def close_room(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    room = await _room(db, room_id)
    await service.close_room(db, room, user)
    await state.broadcaster.publish(room.id, server_message("room.closed"))


@router.post("/{room_id}/reopen", response_model=RoomOut)
async def reopen_room(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Reabre uma campanha arquivada (o PIN muda se outra mesa aberta estiver usando o antigo)."""
    room = await service.reopen_room(db, await _room(db, room_id), user)
    return await _view(db, state, room, user)
