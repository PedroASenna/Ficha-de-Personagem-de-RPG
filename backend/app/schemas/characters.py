import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import AttributeMethod, CharacterStatus, Recharge


class CharacterCreate(BaseModel):
    ruleset_id: str = Field(max_length=64)
    name: str = Field(default="", max_length=60)


class CharacterQuickCreate(BaseModel):
    """Criação expressa: um toque gera um personagem jogável (o resto é aleatório/automático)."""

    ruleset_id: str = Field(max_length=64)
    name: str = Field(min_length=1, max_length=60)
    ancestry_key: str | None = Field(default=None, max_length=64)
    class_key: str | None = Field(default=None, max_length=64)
    background_key: str | None = Field(default=None, max_length=64)


class CharacterPatch(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    portrait_key: str | None = Field(default=None, max_length=255)
    ancestry_key: str | None = Field(default=None, max_length=64)
    ancestry_name: str | None = Field(default=None, max_length=60)
    ancestry_choices: list[str] | None = Field(default=None, max_length=6)
    class_key: str | None = Field(default=None, max_length=64)
    class_name: str | None = Field(default=None, max_length=60)
    background_key: str | None = Field(default=None, max_length=64)
    background_name: str | None = Field(default=None, max_length=60)
    background_bonus: dict[str, int] | None = None
    wizard_step: int | None = Field(default=None, ge=0, le=20)
    level: int | None = Field(default=None, ge=1, le=30)
    hp_max: int | None = Field(default=None, ge=1, le=9999)
    conditions: list[str] | None = Field(default=None, max_length=20)
    notes: str | None = Field(default=None, max_length=5000)


class AttributeGenerateIn(BaseModel):
    method: AttributeMethod
    scores: dict[str, int] | None = None


class HpChangeIn(BaseModel):
    delta: int = Field(ge=1, le=9999)
    kind: Literal["damage", "heal", "temp"]
    expected_version: int | None = None


class RestIn(BaseModel):
    type: Literal["short", "long"]


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    quantity: int = Field(default=1, ge=1, le=9999)
    weight_each: Decimal = Field(default=Decimal("0"), ge=0, le=9999, decimal_places=2)
    equipped: bool = False


class ItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    quantity: int | None = Field(default=None, ge=1, le=9999)
    weight_each: Decimal | None = Field(default=None, ge=0, le=9999, decimal_places=2)
    equipped: bool | None = None


class AbilityIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    level: int = Field(default=0, ge=0, le=9)
    uses_max: int = Field(default=1, ge=1, le=99)
    recharge: Recharge = Recharge.LONG_REST


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    quantity: int
    weight_each: Decimal
    equipped: bool


class AbilityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    level: int
    uses_max: int
    uses_spent: int
    recharge: Recharge
    available: bool


class LoadOut(BaseModel):
    total_weight: float
    capacity: float
    unit: str
    encumbered: bool
    ratio: float


class CharacterOut(BaseModel):
    id: uuid.UUID
    ruleset_id: str
    ruleset_version: str
    status: CharacterStatus
    wizard_step: int
    missing: list[str]
    name: str
    portrait_key: str | None
    portrait_url: str | None
    ancestry_key: str | None
    ancestry_name: str | None
    ancestry_choices: list[str]
    class_key: str | None
    class_name: str | None
    background_key: str | None
    background_name: str | None
    background_bonus: dict[str, int]
    level: int
    attributes: dict[str, int]
    modifiers: dict[str, int]
    attribute_method: AttributeMethod | None
    attribute_audit: dict[str, Any]
    hp_max: int
    hp_current: int
    hp_temp: int
    spell_slots: dict[str, Any]
    conditions: list[str]
    notes: str
    version: int
    items: list[ItemOut]
    abilities: list[AbilityOut]
    load: LoadOut
    updated_at: datetime


class HpTransitionOut(BaseModel):
    character_id: uuid.UUID
    kind: Literal["damage", "heal", "temp"]
    delta: int
    hp_before: int
    hp_current: int
    hp_max: int
    hp_temp: int
    absorbed_by_temp: int
    effect: str
    version: int
