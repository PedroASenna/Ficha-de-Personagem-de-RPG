import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.models.enums import FactionKind, RelationKind

Coord = Field(ge=-10000, le=20000)


class SceneIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    map_key: str | None = Field(default=None, max_length=255)
    map_width: int = Field(default=2000, ge=100, le=8192)
    map_height: int = Field(default=1400, ge=100, le=8192)
    grid_size: int = Field(default=70, ge=10, le=500)
    grid_visible: bool = True
    fog_enabled: bool = False
    fog_radius: int = Field(default=4, ge=1, le=30)


class ScenePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    map_key: str | None = Field(default=None, max_length=255)
    map_width: int | None = Field(default=None, ge=100, le=8192)
    map_height: int | None = Field(default=None, ge=100, le=8192)
    grid_size: int | None = Field(default=None, ge=10, le=500)
    grid_visible: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1000)
    fog_enabled: bool | None = None
    fog_radius: int | None = Field(default=None, ge=1, le=30)


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
    rotation: float = Field(default=0, ge=-360, le=360)

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
    rotation: float | None = Field(default=None, ge=-360, le=360)
    # Entra num objeto (carroça, barco...) ou sai dele com null.
    container_id: uuid.UUID | None = None


class SceneImageIn(BaseModel):
    """Peça de cenário (imagem enviada com kind=piece ou map)."""

    image_key: str = Field(max_length=255)
    x: float = Coord
    y: float = Coord
    width: float = Field(ge=4, le=20000)
    height: float = Field(ge=4, le=20000)
    rotation: float = Field(default=0, ge=-360, le=360)
    z: int | None = Field(default=None, ge=-1000, le=1000)
    locked: bool = False


class SceneImagePatch(BaseModel):
    x: float | None = Field(default=None, ge=-10000, le=20000)
    y: float | None = Field(default=None, ge=-10000, le=20000)
    width: float | None = Field(default=None, ge=4, le=20000)
    height: float | None = Field(default=None, ge=4, le=20000)
    rotation: float | None = Field(default=None, ge=-360, le=360)
    z: int | None = Field(default=None, ge=-1000, le=1000)
    locked: bool | None = None


class SceneImageBatchItem(SceneImagePatch):
    id: uuid.UUID


class SceneImageBatch(BaseModel):
    """Várias peças de uma vez (seleção múltipla: mover, girar ou redimensionar juntas)."""

    items: list[SceneImageBatchItem] = Field(min_length=1, max_length=200)


class SceneObjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    image_key: str | None = Field(default=None, max_length=255)
    x: float = Coord
    y: float = Coord
    width: float = Field(default=140, ge=10, le=20000)
    height: float = Field(default=140, ge=10, le=20000)
    rotation: float = Field(default=0, ge=-360, le=360)
    hide_occupants: bool = False


class SceneObjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    image_key: str | None = Field(default=None, max_length=255)
    x: float | None = Field(default=None, ge=-10000, le=20000)
    y: float | None = Field(default=None, ge=-10000, le=20000)
    width: float | None = Field(default=None, ge=10, le=20000)
    height: float | None = Field(default=None, ge=10, le=20000)
    rotation: float | None = Field(default=None, ge=-360, le=360)
    z: int | None = Field(default=None, ge=-1000, le=1000)
    hide_occupants: bool | None = None


class FogResetIn(BaseModel):
    # Sem personagem: apaga a exploração de todos nesta cena.
    character_id: uuid.UUID | None = None


class WorldPatch(BaseModel):
    map_key: str | None = Field(default=None, max_length=255)
    map_width: int | None = Field(default=None, ge=16, le=8192)
    map_height: int | None = Field(default=None, ge=16, le=8192)
    visible: bool | None = None


Color = Field(default="#8a6d3b", pattern=r"^#[0-9a-fA-F]{6}$")


class FactionIn(BaseModel):
    kind: FactionKind
    name: str = Field(min_length=1, max_length=60)
    emblem_key: str | None = Field(default=None, max_length=255)
    color: str = Color
    leader: str = Field(default="", max_length=80)
    seat: str = Field(default="", max_length=80)
    description: str = Field(default="", max_length=5000)
    secret_notes: str = Field(default="", max_length=5000)
    parent_id: uuid.UUID | None = None
    revealed: bool = False


class FactionPatch(BaseModel):
    kind: FactionKind | None = None
    name: str | None = Field(default=None, min_length=1, max_length=60)
    emblem_key: str | None = Field(default=None, max_length=255)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    leader: str | None = Field(default=None, max_length=80)
    seat: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=5000)
    secret_notes: str | None = Field(default=None, max_length=5000)
    parent_id: uuid.UUID | None = None
    revealed: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)


class RelationIn(BaseModel):
    """Cria ou substitui a relação entre duas nações/facções."""

    a_id: uuid.UUID
    b_id: uuid.UUID
    kind: RelationKind
    note: str = Field(default="", max_length=200)
    revealed: bool = False


class ImageOut(BaseModel):
    key: str
    url: str
    width: int
    height: int


TableView = dict[str, Any]
