"""Mesa virtual do Mestre: cenas (mapas), inimigos/NPCs e bonecos (tokens) posicionados nas cenas."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Scene(TimestampMixin, Base):
    """Um mapa da campanha. O grupo pode estar espalhado em várias cenas ao mesmo tempo."""

    __tablename__ = "scenes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    map_key: Mapped[str | None] = mapped_column(String(255))
    map_width: Mapped[int] = mapped_column(default=2000)
    map_height: Mapped[int] = mapped_column(default=1400)
    # Tamanho de uma célula da grade em pixels do mapa (os tokens medem em células).
    grid_size: Mapped[int] = mapped_column(default=70)
    grid_visible: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)


class Npc(TimestampMixin, Base):
    """Inimigo ou NPC criado pelo Mestre. Os jogadores só veem nome, imagem e um estado vago."""

    __tablename__ = "npcs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    portrait_key: Mapped[str | None] = mapped_column(String(255))
    hp_max: Mapped[int] = mapped_column(default=10)
    hp_current: Mapped[int] = mapped_column(default=10)
    hp_temp: Mapped[int] = mapped_column(default=0)
    armor_class: Mapped[int | None]
    # Chaves dos atributos do sistema de regras da mesa (ex.: {"str": 14, "dex": 12}).
    attributes: Mapped[dict[str, Any]] = mapped_column(default=dict)
    notes: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(default=1)


class Token(Base):
    """Boneco no mapa: aponta para um personagem de jogador OU para um NPC."""

    __tablename__ = "tokens"
    __table_args__ = (
        CheckConstraint(
            "(character_id IS NOT NULL AND npc_id IS NULL) OR (character_id IS NULL AND npc_id IS NOT NULL)",
            name="one_owner",
        ),
        # Um boneco por personagem na mesa: mudar de cena = trocar scene_id.
        Index(
            "uq_tokens_room_character",
            "room_id",
            "character_id",
            unique=True,
            postgresql_where=text("character_id IS NOT NULL"),
            sqlite_where=text("character_id IS NOT NULL"),
        ),
        Index("ix_tokens_scene", "scene_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    scene_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"))
    character_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    npc_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("npcs.id", ondelete="CASCADE"))
    # Posição do centro do boneco em pixels do mapa.
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)
    # Diâmetro em células da grade (1 = criatura média; 2 = grande...).
    size: Mapped[float] = mapped_column(Float, default=1)
    # Escondido: só o Mestre vê (emboscadas).
    hidden: Mapped[bool] = mapped_column(default=False)
    z: Mapped[int] = mapped_column(default=0)
    version: Mapped[int] = mapped_column(default=1)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
