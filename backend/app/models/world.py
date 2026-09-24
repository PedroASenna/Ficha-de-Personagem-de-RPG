"""Mapa-múndi da campanha: nações e facções com ficha própria e as relações entre elas."""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.models.enums import FactionKind, RelationKind, str_enum


class Faction(TimestampMixin, Base):
    """Nação ou facção. Os jogadores só veem as reveladas pelo Mestre, e nunca as notas secretas."""

    __tablename__ = "factions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    kind: Mapped[FactionKind] = mapped_column(str_enum(FactionKind))
    name: Mapped[str] = mapped_column(String(60))
    emblem_key: Mapped[str | None] = mapped_column(String(255))
    color: Mapped[str] = mapped_column(String(7), default="#8a6d3b")
    leader: Mapped[str] = mapped_column(String(80), default="")
    # Capital (nação) ou sede (facção).
    seat: Mapped[str] = mapped_column(String(80), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    secret_notes: Mapped[str] = mapped_column(Text, default="")
    # Facção que atua dentro de uma nação (ex.: a guilda de ladrões do Império).
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("factions.id", ondelete="SET NULL"))
    revealed: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(default=0)
    version: Mapped[int] = mapped_column(default=1)


class FactionRelation(Base):
    """Relação entre duas nações/facções (guardada uma vez por par, com a_id < b_id)."""

    __tablename__ = "faction_relations"
    __table_args__ = (
        UniqueConstraint("a_id", "b_id", name="uq_faction_relations_pair"),
        CheckConstraint("a_id <> b_id", name="distinct_pair"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    a_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("factions.id", ondelete="CASCADE"))
    b_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("factions.id", ondelete="CASCADE"))
    kind: Mapped[RelationKind] = mapped_column(str_enum(RelationKind))
    note: Mapped[str] = mapped_column(String(200), default="")
    revealed: Mapped[bool] = mapped_column(default=False)
    version: Mapped[int] = mapped_column(default=1)
