import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AppState, get_current_user, get_db, get_state
from app.core.errors import NotFoundError, RateLimitedError
from app.models import Room, RoomMember, User
from app.models.enums import RoomStatus
from app.schemas.rooms import EventOut, KickIn, RoomCreate, RoomJoin, RoomOut, SetCharacterIn
from app.services import rooms as service
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
    room = await service.create_room(db, user, data.name, data.ruleset_id, data.max_players, state.registry)
    return await _view(db, state, room, user)


@router.get("", response_model=list[RoomOut])
async def my_rooms(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), state: AppState = Depends(get_state)
):
    rooms = await db.scalars(
        select(Room)
        .join(RoomMember, RoomMember.room_id == Room.id)
        .where(RoomMember.user_id == user.id, RoomMember.kicked_at.is_(None), Room.status == RoomStatus.OPEN)
        .order_by(Room.created_at.desc())
    )
    return [await _view(db, state, room, user) for room in rooms.all()]


@router.post("/join", response_model=RoomOut)
async def join_room(
    data: RoomJoin,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    # Limite contra força bruta de PIN (32^6 combinações, mas nunca custa travar).
    if not state.limiters.join_pin.allow(f"join:{user.id}"):
        raise RateLimitedError("Muitas tentativas de PIN. Aguarde um minuto.")
    room = await service.join_room(db, user, data.pin, data.character_id)
    return await _view(db, state, room, user)


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
