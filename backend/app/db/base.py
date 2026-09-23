from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, DateTime, Integer, MetaData, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# JSONB no Postgres; JSON simples no SQLite usado em testes rápidos.
JSONType = JSON().with_variant(JSONB(), "postgresql")
# SQLite só faz autoincremento em INTEGER PRIMARY KEY.
BigIntPK = BigInteger().with_variant(Integer(), "sqlite")

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {
        dict[str, Any]: JSONType,
        list[Any]: JSONType,
        datetime: DateTime(timezone=True),
    }


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
