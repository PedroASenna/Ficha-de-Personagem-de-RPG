import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import AttributeMethod, CharacterStatus, Recharge, str_enum


class Character(TimestampMixin, Base):
    __tablename__ = "characters"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ruleset_id: Mapped[str] = mapped_column(ForeignKey("rulesets.id"))
    ruleset_version: Mapped[str] = mapped_column(String(20))

    # O wizard salva a cada passo: se o app fechar, o jogador continua de onde parou.
    status: Mapped[CharacterStatus] = mapped_column(str_enum(CharacterStatus), default=CharacterStatus.DRAFT)
    wizard_step: Mapped[int] = mapped_column(default=0)

    name: Mapped[str] = mapped_column(String(60), default="")
    portrait_key: Mapped[str | None] = mapped_column(String(255))
    # *_key aponta para o pacote de regras ("custom" = texto livre); *_name é o nome exibido.
    ancestry_key: Mapped[str | None] = mapped_column(String(64))
    ancestry_name: Mapped[str | None] = mapped_column(String(60))
    ancestry_choices: Mapped[list[Any]] = mapped_column(default=list)
    class_key: Mapped[str | None] = mapped_column(String(64))
    class_name: Mapped[str | None] = mapped_column(String(60))
    background_key: Mapped[str | None] = mapped_column(String(64))
    background_name: Mapped[str | None] = mapped_column(String(60))
    background_bonus: Mapped[dict[str, Any]] = mapped_column(default=dict)
    level: Mapped[int] = mapped_column(default=1)

    # attributes = valores finais (base + bônus). attribute_audit guarda método, base, bônus e rolagens.
    attributes: Mapped[dict[str, Any]] = mapped_column(default=dict)
    attribute_method: Mapped[AttributeMethod | None] = mapped_column(str_enum(AttributeMethod))
    attribute_audit: Mapped[dict[str, Any]] = mapped_column(default=dict)

    hp_max: Mapped[int] = mapped_column(default=0)
    hp_current: Mapped[int] = mapped_column(default=0)
    hp_temp: Mapped[int] = mapped_column(default=0)
    # {"1": {"max": 2, "used": 0}, ...}
    spell_slots: Mapped[dict[str, Any]] = mapped_column(default=dict)
    conditions: Mapped[list[Any]] = mapped_column(default=list)
    notes: Mapped[str] = mapped_column(Text, default="")

    # Concorrência otimista: HP pode ser alterado pelo jogador e pelo Mestre ao mesmo tempo.
    version: Mapped[int] = mapped_column(default=1)

    items: Mapped[list["InventoryItem"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", order_by="InventoryItem.created_at"
    )
    abilities: Mapped[list["CharacterAbility"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", order_by="CharacterAbility.created_at"
    )


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    character_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    quantity: Mapped[int] = mapped_column(default=1)
    weight_each: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0"))
    equipped: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    character: Mapped[Character] = relationship(back_populates="items")


class CharacterAbility(Base):
    """Magias e habilidades com usos limitados; o botão fica cinza até o descanso certo."""

    __tablename__ = "character_abilities"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    character_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    level: Mapped[int] = mapped_column(default=0)
    uses_max: Mapped[int] = mapped_column(default=1)
    uses_spent: Mapped[int] = mapped_column(default=0)
    recharge: Mapped[Recharge] = mapped_column(str_enum(Recharge), default=Recharge.LONG_REST)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    character: Mapped[Character] = relationship(back_populates="abilities")
