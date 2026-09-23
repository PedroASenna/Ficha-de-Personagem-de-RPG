import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import RoomRole, RoomStatus, SessionEventType, Visibility


class RoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    ruleset_id: str = Field(max_length=64)
    max_players: int = Field(default=8, ge=1, le=12)


class RoomJoin(BaseModel):
    pin: str = Field(min_length=6, max_length=6)
    character_id: uuid.UUID | None = None

    @field_validator("pin")
    @classmethod
    def _upper(cls, value: str) -> str:
        return value.strip().upper()


class SetCharacterIn(BaseModel):
    character_id: uuid.UUID


class KickIn(BaseModel):
    user_id: uuid.UUID


class MemberCharacterOut(BaseModel):
    id: uuid.UUID
    name: str
    class_name: str | None
    hp_current: int
    hp_max: int
    hp_temp: int
    portrait_url: str | None
    version: int


class RoomMemberOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    role: RoomRole
    online: bool = False
    character: MemberCharacterOut | None


class RoomOut(BaseModel):
    id: uuid.UUID
    pin: str
    name: str
    ruleset_id: str
    ruleset_name: str
    status: RoomStatus
    max_players: int
    my_role: RoomRole
    members: list[RoomMemberOut]
    created_at: datetime


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: SessionEventType
    visibility: Visibility
    actor_user_id: uuid.UUID | None
    character_id: uuid.UUID | None
    payload: dict[str, Any]
    created_at: datetime
