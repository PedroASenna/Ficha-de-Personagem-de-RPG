import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(40))
    locale: Mapped[str] = mapped_column(String(10), default="pt-BR")
    # Minimização (LGPD): guardamos só a confirmação de idade mínima, nunca a data de nascimento.
    age_gate_confirmed_at: Mapped[datetime]
    terms_version: Mapped[str] = mapped_column(String(20))
    privacy_version: Mapped[str] = mapped_column(String(20))
    consent_at: Mapped[datetime]
    # Conta excluída: dados pessoais anonimizados na hora; a linha é expurgada depois (account_purge_days).
    deleted_at: Mapped[datetime | None]


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
