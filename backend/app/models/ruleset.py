from typing import Any

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.models.enums import RulesetStatus, str_enum


class Ruleset(TimestampMixin, Base):
    """Sistema de regras escolhido pelo Mestre ao criar a sala.

    O conteúdo (atributos, raças, classes...) vem dos pacotes em app/rulesets/data e é
    sincronizado no startup; o banco guarda uma cópia para integridade referencial e histórico.
    """

    __tablename__ = "rulesets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(120))
    license: Mapped[str] = mapped_column(String(40))
    license_url: Mapped[str | None] = mapped_column(String(255))
    attribution: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[RulesetStatus] = mapped_column(str_enum(RulesetStatus))
    pack: Mapped[dict[str, Any] | None]
    content_hash: Mapped[str] = mapped_column(String(64))
