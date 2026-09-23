import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import ReportReason, ReportStatus, ReportTarget, str_enum


class UserBlock(Base):
    """Bloqueio entre usuários (exigido pela política de UGC da Play Store)."""

    __tablename__ = "user_blocks"

    blocker_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    blocked_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ContentReport(Base):
    """Denúncia de conteúdo gerado pelo usuário (nome, retrato, sala, evento)."""

    __tablename__ = "content_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    target_type: Mapped[ReportTarget] = mapped_column(str_enum(ReportTarget))
    target_id: Mapped[str] = mapped_column(String(64))
    reason: Mapped[ReportReason] = mapped_column(str_enum(ReportReason))
    details: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[ReportStatus] = mapped_column(str_enum(ReportStatus), default=ReportStatus.OPEN)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    resolved_at: Mapped[datetime | None]
