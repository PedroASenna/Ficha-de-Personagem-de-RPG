import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BigIntPK, TimestampMixin
from app.models.enums import RoomRole, RoomStatus, SessionEventType, Visibility, str_enum


class Room(TimestampMixin, Base):
    """Mesa/campanha do Mestre. O sistema de regras é fixado na criação e a mesa não expira."""

    __tablename__ = "rooms"
    __table_args__ = (
        # O PIN só precisa ser único entre salas abertas; PINs de salas fechadas podem voltar a ser usados.
        Index(
            "uq_rooms_open_pin",
            "pin",
            unique=True,
            postgresql_where=text("status = 'open'"),
            sqlite_where=text("status = 'open'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    pin: Mapped[str] = mapped_column(String(6))
    name: Mapped[str] = mapped_column(String(60))
    master_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ruleset_id: Mapped[str] = mapped_column(ForeignKey("rulesets.id"))
    status: Mapped[RoomStatus] = mapped_column(str_enum(RoomStatus), default=RoomStatus.OPEN)
    max_players: Mapped[int] = mapped_column(default=8)
    # Campanha persistente: "closed" = arquivada (o Mestre reabre quando quiser).
    closed_at: Mapped[datetime | None]
    last_activity_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # Mapa-múndi da campanha (nações e facções ficam em app/models/world.py). Os jogadores só veem
    # a imagem depois que o Mestre libera.
    world_map_key: Mapped[str | None] = mapped_column(String(255))
    world_map_width: Mapped[int | None]
    world_map_height: Mapped[int | None]
    world_visible: Mapped[bool] = mapped_column(default=False)


class RoomMember(Base):
    __tablename__ = "room_members"

    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    character_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"))
    role: Mapped[RoomRole] = mapped_column(str_enum(RoomRole))
    joined_at: Mapped[datetime] = mapped_column(server_default=func.now())
    kicked_at: Mapped[datetime | None]


class SessionEvent(Base):
    """Log da sessão que o Mestre acompanha (rolagens, dano/cura, entradas e saídas)."""

    __tablename__ = "session_events"
    __table_args__ = (Index("ix_session_events_room_created", "room_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    character_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"))
    type: Mapped[SessionEventType] = mapped_column(str_enum(SessionEventType))
    visibility: Mapped[Visibility] = mapped_column(str_enum(Visibility), default=Visibility.PUBLIC)
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
