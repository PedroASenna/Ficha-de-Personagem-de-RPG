from enum import StrEnum

from sqlalchemy import Enum


def str_enum(enum_cls: type[StrEnum]) -> Enum:
    """Enum guardado como VARCHAR (portável e sem ALTER TYPE nas migrações)."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=32,
        values_callable=lambda members: [m.value for m in members],
        validate_strings=True,
    )


class RulesetStatus(StrEnum):
    AVAILABLE = "available"
    PLANNED = "planned"
    RESTRICTED = "restricted"


class CharacterStatus(StrEnum):
    DRAFT = "draft"
    COMPLETE = "complete"


class AttributeMethod(StrEnum):
    STANDARD_ARRAY = "standard_array"
    POINT_BUY = "point_buy"
    ROLL = "roll"
    CLASS_PRESET = "class_preset"
    MANUAL = "manual"


class Recharge(StrEnum):
    SHORT_REST = "short_rest"
    LONG_REST = "long_rest"
    NONE = "none"


class RoomStatus(StrEnum):
    OPEN = "open"
    CLOSED = "closed"


class RoomRole(StrEnum):
    MASTER = "master"
    PLAYER = "player"


class SessionEventType(StrEnum):
    DICE_ROLL = "dice_roll"
    HP_CHANGE = "hp_change"
    JOIN = "join"
    LEAVE = "leave"
    REST = "rest"
    LEVEL_UP = "level_up"
    SYSTEM = "system"


class FactionKind(StrEnum):
    NATION = "nation"
    FACTION = "faction"


class RelationKind(StrEnum):
    ALLIANCE = "alliance"
    FRIENDLY = "friendly"
    NEUTRAL = "neutral"
    TENSE = "tense"
    WAR = "war"


class Visibility(StrEnum):
    PUBLIC = "public"
    MASTER_ONLY = "master_only"


class ReportTarget(StrEnum):
    USER = "user"
    CHARACTER = "character"
    ROOM = "room"
    EVENT = "event"


class ReportReason(StrEnum):
    HARASSMENT = "harassment"
    SEXUAL = "sexual"
    HATE = "hate"
    VIOLENCE = "violence"
    SPAM = "spam"
    OTHER = "other"


class ReportStatus(StrEnum):
    OPEN = "open"
    REVIEWING = "reviewing"
    ACTIONED = "actioned"
    DISMISSED = "dismissed"
