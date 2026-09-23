import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class SceneIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    map_key: str | None = Field(default=None, max_length=255)
    map_width: int = Field(default=2000, ge=100, le=8192)
    map_height: int = Field(default=1400, ge=100, le=8192)
    grid_size: int = Field(default=70, ge=10, le=500)
    grid_visible: bool = True


class ScenePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    map_key: str | None = Field(default=None, max_length=255)
    map_width: int | None = Field(default=None, ge=100, le=8192)
    map_height: int | None = Field(default=None, ge=100, le=8192)
    grid_size: int | None = Field(default=None, ge=10, le=500)
    grid_visible: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1000)


class NpcIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    portrait_key: str | None = Field(default=None, max_length=255)
    hp_max: int = Field(default=10, ge=1, le=99999)
    armor_class: int | None = Field(default=None, ge=0, le=99)
    attributes: dict[str, int] = Field(default_factory=dict)
    notes: str = Field(default="", max_length=5000)
    # Cria "Goblin 1", "Goblin 2"... de uma vez.
    count: int = Field(default=1, ge=1, le=30)


class NpcPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    portrait_key: str | None = Field(default=None, max_length=255)
    hp_max: int | None = Field(default=None, ge=1, le=99999)
    armor_class: int | None = Field(default=None, ge=0, le=99)
    attributes: dict[str, int] | None = None
    notes: str | None = Field(default=None, max_length=5000)


class NpcHpIn(BaseModel):
    delta: int = Field(ge=1, le=99999)
    kind: Literal["damage", "heal", "temp"]
    expected_version: int | None = None


class TokenIn(BaseModel):
    scene_id: uuid.UUID
    character_id: uuid.UUID | None = None
    npc_id: uuid.UUID | None = None
    x: float = Field(ge=-10000, le=20000)
    y: float = Field(ge=-10000, le=20000)
    size: float = Field(default=1, ge=0.25, le=10)
    hidden: bool = False

    @model_validator(mode="after")
    def _one_owner(self) -> "TokenIn":
        if (self.character_id is None) == (self.npc_id is None):
            raise ValueError("Informe character_id OU npc_id.")
        return self


class TokenPatch(BaseModel):
    scene_id: uuid.UUID | None = None
    x: float | None = Field(default=None, ge=-10000, le=20000)
    y: float | None = Field(default=None, ge=-10000, le=20000)
    size: float | None = Field(default=None, ge=0.25, le=10)
    hidden: bool | None = None
    z: int | None = Field(default=None, ge=-100, le=100)


class ImageOut(BaseModel):
    key: str
    url: str
    width: int
    height: int


TableView = dict[str, Any]
