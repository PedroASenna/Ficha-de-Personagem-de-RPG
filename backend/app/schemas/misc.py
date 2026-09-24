import uuid
from typing import Any

from pydantic import BaseModel, Field

from app.models.enums import ReportReason, ReportTarget, RulesetStatus


class RulesetSummary(BaseModel):
    id: str
    name: str
    short_name: str | None = None
    version: str
    status: RulesetStatus
    license: str
    license_url: str | None
    attribution: str
    description: str
    notes: str | None = None
    engine: str = "classic"


class RollIn(BaseModel):
    notation: str = Field(min_length=1, max_length=64)
    ruleset_id: str | None = Field(default=None, max_length=64)
    target: int | None = Field(default=None, ge=-50, le=200)
    wild: bool = False


class RollOut(BaseModel):
    roll: dict[str, Any]
    outcome: dict[str, Any]
    # Resultado do teste (sucesso, margem, ampliações, crítico) quando houve alvo ou Dado Selvagem.
    check: dict[str, Any] | None = None


class ReportIn(BaseModel):
    target_type: ReportTarget
    target_id: str = Field(min_length=1, max_length=64)
    reason: ReportReason
    details: str = Field(default="", max_length=1000)


class BlockIn(BaseModel):
    user_id: uuid.UUID


class PortraitOut(BaseModel):
    portrait_key: str
    url: str
