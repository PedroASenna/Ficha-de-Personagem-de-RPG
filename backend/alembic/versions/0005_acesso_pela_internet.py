"""acesso pela internet: aprovação de entrada nas mesas

- rooms.require_approval: quem entra pelo PIN espera o Mestre aceitar
- room_join_requests: pedidos de entrada (pendentes ou recusados há pouco)

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-30 12:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.add_column(sa.Column("require_approval", sa.Boolean(), server_default=sa.false(), nullable=False))

    op.create_table(
        "room_join_requests",
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("character_id", sa.Uuid(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "denied", name="joinrequeststatus", native_enum=False, length=32),
            nullable=False,
        ),
        sa.Column("remote", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["characters.id"],
            name=op.f("fk_room_join_requests_character_id_characters"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["room_id"], ["rooms.id"], name=op.f("fk_room_join_requests_room_id_rooms"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_room_join_requests_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("room_id", "user_id", name=op.f("pk_room_join_requests")),
    )


def downgrade() -> None:
    op.drop_table("room_join_requests")
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.drop_column("require_approval")
