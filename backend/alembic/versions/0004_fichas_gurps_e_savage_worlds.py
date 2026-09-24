"""fichas com motor próprio (GURPS e Savage Worlds)

- characters.build: o que o jogador comprou (pontos, vantagens, perícias, Complicações, Progressos...)

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-24 14:10:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    with op.batch_alter_table("characters") as batch_op:
        batch_op.add_column(sa.Column("build", JSON, server_default=sa.text("'{}'"), nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("characters") as batch_op:
        batch_op.drop_column("build")
