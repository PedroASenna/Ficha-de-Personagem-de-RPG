"""Salas do Mestre: criação com sistema de regras, entrada por PIN, log da sessão."""

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, DomainError, ForbiddenError, NotFoundError
from app.models import Character, Room, RoomMember, SessionEvent, User
from app.models.enums import CharacterStatus, RoomRole, RoomStatus, SessionEventType, Visibility
from app.rulesets.loader import RulesetRegistry
from app.schemas.rooms import MemberCharacterOut, RoomMemberOut, RoomOut
from app.services.media import MediaStore

# Sem 0/O, 1/I: o PIN é ditado em voz alta na mesa.
PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
PIN_LENGTH = 6
ROOM_TTL = timedelta(hours=24)


def new_pin() -> str:
    return "".join(secrets.choice(PIN_ALPHABET) for _ in range(PIN_LENGTH))


async def create_room(
    session: AsyncSession, master: User, name: str, ruleset_id: str, max_players: int, registry: RulesetRegistry
) -> Room:
    pack = registry.get(ruleset_id)
    if pack is None or pack.status != "available":
        raise DomainError("Escolha um sistema de regras disponível para criar a sala.")
    for _ in range(10):
        room = Room(
            pin=new_pin(),
            name=name.strip(),
            master_id=master.id,
            ruleset_id=ruleset_id,
            max_players=max_players,
            status=RoomStatus.OPEN,
            expires_at=datetime.now(UTC) + ROOM_TTL,
        )
        session.add(room)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            continue
        session.add(RoomMember(room_id=room.id, user_id=master.id, role=RoomRole.MASTER))
        await session.commit()
        return room
    raise ConflictError("Não foi possível gerar um PIN. Tente de novo.")


async def get_open_room_by_pin(session: AsyncSession, pin: str) -> Room:
    room = await session.scalar(select(Room).where(Room.pin == pin.upper(), Room.status == RoomStatus.OPEN))
    if room is None or (room.expires_at and _aware(room.expires_at) < datetime.now(UTC)):
        raise NotFoundError("Sala não encontrada. Confira o PIN.")
    return room


async def get_member(session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID) -> RoomMember | None:
    return await session.get(RoomMember, (room_id, user_id))


async def require_member(session: AsyncSession, room: Room, user: User) -> RoomMember:
    member = await get_member(session, room.id, user.id)
    if member is None or member.kicked_at is not None:
        raise ForbiddenError("Você não participa desta sala.")
    return member


async def _validate_character(session: AsyncSession, room: Room, user: User, character_id: uuid.UUID) -> Character:
    character = await session.get(Character, character_id)
    if character is None or character.owner_id != user.id:
        raise NotFoundError("Personagem não encontrado.")
    if character.ruleset_id != room.ruleset_id:
        raise DomainError("Este personagem é de outro sistema de regras. Crie um novo para esta mesa.")
    if character.status != CharacterStatus.COMPLETE:
        raise DomainError("Conclua o personagem antes de entrar na mesa.")
    return character


async def join_room(session: AsyncSession, user: User, pin: str, character_id: uuid.UUID | None) -> Room:
    room = await get_open_room_by_pin(session, pin)
    member = await get_member(session, room.id, user.id)
    if member and member.kicked_at is not None:
        raise ForbiddenError("Você foi removido desta sala pelo Mestre.")
    character = await _validate_character(session, room, user, character_id) if character_id else None

    if member is None:
        players = await session.scalar(
            select(func.count())
            .select_from(RoomMember)
            .where(RoomMember.room_id == room.id, RoomMember.role == RoomRole.PLAYER, RoomMember.kicked_at.is_(None))
        )
        if players >= room.max_players:
            raise ConflictError("A sala está cheia.")
        member = RoomMember(room_id=room.id, user_id=user.id, role=RoomRole.PLAYER)
        session.add(member)
        await record_event(
            session,
            room.id,
            user.id,
            SessionEventType.JOIN,
            {"summary": f"{user.display_name} entrou na mesa."},
            character_id=character.id if character else None,
        )
    if character:
        member.character_id = character.id
    await session.commit()
    return room


async def set_character(session: AsyncSession, room: Room, user: User, character_id: uuid.UUID) -> None:
    member = await require_member(session, room, user)
    character = await _validate_character(session, room, user, character_id)
    member.character_id = character.id
    await session.commit()


async def record_event(
    session: AsyncSession,
    room_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    event_type: SessionEventType,
    payload: dict[str, Any],
    *,
    character_id: uuid.UUID | None = None,
    visibility: Visibility = Visibility.PUBLIC,
) -> SessionEvent:
    event = SessionEvent(
        room_id=room_id,
        actor_user_id=actor_id,
        character_id=character_id,
        type=event_type,
        visibility=visibility,
        payload=payload,
    )
    session.add(event)
    await session.flush()
    return event


async def list_events(
    session: AsyncSession, room: Room, viewer: RoomMember, limit: int = 50, before_id: int | None = None
) -> list[SessionEvent]:
    query = select(SessionEvent).where(SessionEvent.room_id == room.id)
    if viewer.role != RoomRole.MASTER:
        query = query.where(
            (SessionEvent.visibility == Visibility.PUBLIC) | (SessionEvent.actor_user_id == viewer.user_id)
        )
    if before_id:
        query = query.where(SessionEvent.id < before_id)
    rows = (await session.scalars(query.order_by(SessionEvent.id.desc()).limit(limit))).all()
    return list(reversed(rows))


async def close_room(session: AsyncSession, room: Room, user: User) -> None:
    if room.master_id != user.id:
        raise ForbiddenError("Só o Mestre pode encerrar a sala.")
    room.status = RoomStatus.CLOSED
    room.closed_at = datetime.now(UTC)
    await session.commit()


async def kick(session: AsyncSession, room: Room, master: User, user_id: uuid.UUID) -> None:
    if room.master_id != master.id:
        raise ForbiddenError("Só o Mestre pode remover jogadores.")
    if user_id == master.id:
        raise DomainError("O Mestre não pode se remover.")
    member = await get_member(session, room.id, user_id)
    if member is None:
        raise NotFoundError("Jogador não está na sala.")
    member.kicked_at = datetime.now(UTC)
    await record_event(session, room.id, master.id, SessionEventType.LEAVE, {"summary": "Um jogador foi removido."})
    await session.commit()


async def room_out(
    session: AsyncSession,
    room: Room,
    viewer_id: uuid.UUID,
    registry: RulesetRegistry,
    media: MediaStore,
    online: set[uuid.UUID] | None = None,
) -> RoomOut:
    rows = (
        await session.execute(
            select(RoomMember, User, Character)
            .join(User, User.id == RoomMember.user_id)
            .outerjoin(Character, Character.id == RoomMember.character_id)
            .where(RoomMember.room_id == room.id, RoomMember.kicked_at.is_(None))
            .order_by(RoomMember.joined_at)
        )
    ).all()
    members = []
    my_role = RoomRole.PLAYER
    for member, user, character in rows:
        if user.id == viewer_id:
            my_role = member.role
        members.append(
            RoomMemberOut(
                user_id=user.id,
                display_name=user.display_name,
                role=member.role,
                online=user.id in (online or set()),
                character=(
                    MemberCharacterOut(
                        id=character.id,
                        name=character.name,
                        class_name=character.class_name,
                        hp_current=character.hp_current,
                        hp_max=character.hp_max,
                        hp_temp=character.hp_temp,
                        portrait_url=media.url(character.portrait_key) if character.portrait_key else None,
                        version=character.version,
                    )
                    if character
                    else None
                ),
            )
        )
    pack = registry.get(room.ruleset_id)
    return RoomOut(
        id=room.id,
        pin=room.pin,
        name=room.name,
        ruleset_id=room.ruleset_id,
        ruleset_name=pack.name if pack else room.ruleset_id,
        status=room.status,
        max_players=room.max_players,
        my_role=my_role,
        members=members,
        created_at=room.created_at,
    )


def _aware(value: datetime) -> datetime:
    # SQLite devolve datetime sem fuso; Postgres devolve com fuso.
    return value if value.tzinfo else value.replace(tzinfo=UTC)
