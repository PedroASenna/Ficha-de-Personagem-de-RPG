"""servidor caseiro e mesa virtual

- contas locais: username (único) e is_admin; e-mail opcional; sai age gate/termos (uso doméstico)
- mesas viram campanhas persistentes: sai expires_at, entra last_activity_at
- mesa virtual: scenes, npcs, tokens

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-23 16:43:22.988863+00:00
"""

import re
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def _backfill_usernames() -> None:
    """Contas criadas antes (por e-mail) ganham um username derivado do e-mail; o mais antigo vira admin."""
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, email FROM users ORDER BY created_at")).fetchall()
    used: set[str] = set()
    for index, (user_id, email) in enumerate(rows):
        base = re.sub(r"[^a-z0-9_.-]", "", (email or "jogador").split("@")[0].lower())[:28] or "jogador"
        base = base if len(base) >= 3 else f"{base}___"[:3]
        name, n = base, 1
        while name in used:
            n += 1
            name = f"{base[:28]}{n}"
        used.add(name)
        bind.execute(
            sa.text("UPDATE users SET username = :u, is_admin = :a WHERE id = :id"),
            {"u": name, "a": index == 0, "id": user_id},
        )


def upgrade() -> None:
    op.create_table(
        "npcs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("portrait_key", sa.String(length=255), nullable=True),
        sa.Column("hp_max", sa.Integer(), nullable=False),
        sa.Column("hp_current", sa.Integer(), nullable=False),
        sa.Column("hp_temp", sa.Integer(), nullable=False),
        sa.Column("armor_class", sa.Integer(), nullable=True),
        sa.Column("attributes", JSON, nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], name=op.f("fk_npcs_room_id_rooms"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_npcs")),
    )
    op.create_index(op.f("ix_npcs_room_id"), "npcs", ["room_id"], unique=False)

    op.create_table(
        "scenes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("map_key", sa.String(length=255), nullable=True),
        sa.Column("map_width", sa.Integer(), nullable=False),
        sa.Column("map_height", sa.Integer(), nullable=False),
        sa.Column("grid_size", sa.Integer(), nullable=False),
        sa.Column("grid_visible", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], name=op.f("fk_scenes_room_id_rooms"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scenes")),
    )
    op.create_index(op.f("ix_scenes_room_id"), "scenes", ["room_id"], unique=False)

    op.create_table(
        "tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("scene_id", sa.Uuid(), nullable=False),
        sa.Column("character_id", sa.Uuid(), nullable=True),
        sa.Column("npc_id", sa.Uuid(), nullable=True),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("size", sa.Float(), nullable=False),
        sa.Column("hidden", sa.Boolean(), nullable=False),
        sa.Column("z", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(character_id IS NOT NULL AND npc_id IS NULL) OR (character_id IS NULL AND npc_id IS NOT NULL)",
            name=op.f("ck_tokens_one_owner"),
        ),
        sa.ForeignKeyConstraint(
            ["character_id"], ["characters.id"], name=op.f("fk_tokens_character_id_characters"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["npc_id"], ["npcs.id"], name=op.f("fk_tokens_npc_id_npcs"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], name=op.f("fk_tokens_room_id_rooms"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["scene_id"], ["scenes.id"], name=op.f("fk_tokens_scene_id_scenes"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tokens")),
    )
    op.create_index("ix_tokens_scene", "tokens", ["scene_id"], unique=False)
    op.create_index(
        "uq_tokens_room_character",
        "tokens",
        ["room_id", "character_id"],
        unique=True,
        postgresql_where=sa.text("character_id IS NOT NULL"),
        sqlite_where=sa.text("character_id IS NOT NULL"),
    )

    with op.batch_alter_table("rooms", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("last_activity_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
        )
        batch_op.drop_column("expires_at")

    # username entra nulo, é preenchido e só depois vira obrigatório/único.
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("username", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("is_admin", sa.Boolean(), server_default=sa.false(), nullable=False))
    _backfill_usernames()
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.alter_column("username", existing_type=sa.String(length=32), nullable=False)
        batch_op.alter_column("email", existing_type=sa.VARCHAR(length=320), nullable=True)
        batch_op.drop_index(batch_op.f("ix_users_email"))
        batch_op.create_index(batch_op.f("ix_users_username"), ["username"], unique=True)
        batch_op.create_unique_constraint(batch_op.f("uq_users_email"), ["email"])
        batch_op.drop_column("privacy_version")
        batch_op.drop_column("consent_at")
        batch_op.drop_column("terms_version")
        batch_op.drop_column("age_gate_confirmed_at")


def downgrade() -> None:
    op.execute("UPDATE users SET email = username || '@local.invalid' WHERE email IS NULL")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "age_gate_confirmed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
            )
        )
        batch_op.add_column(sa.Column("terms_version", sa.String(length=20), server_default="2026-09", nullable=False))
        batch_op.add_column(
            sa.Column("consent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
        )
        batch_op.add_column(
            sa.Column("privacy_version", sa.String(length=20), server_default="2026-09", nullable=False)
        )
        batch_op.drop_constraint(batch_op.f("uq_users_email"), type_="unique")
        batch_op.drop_index(batch_op.f("ix_users_username"))
        batch_op.create_index(batch_op.f("ix_users_email"), ["email"], unique=True)
        batch_op.alter_column("email", existing_type=sa.VARCHAR(length=320), nullable=False)
        batch_op.drop_column("is_admin")
        batch_op.drop_column("username")

    with op.batch_alter_table("rooms", schema=None) as batch_op:
        batch_op.add_column(sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.drop_column("last_activity_at")

    op.drop_index("uq_tokens_room_character", table_name="tokens")
    op.drop_index("ix_tokens_scene", table_name="tokens")
    op.drop_table("tokens")
    op.drop_index(op.f("ix_scenes_room_id"), table_name="scenes")
    op.drop_table("scenes")
    op.drop_index(op.f("ix_npcs_room_id"), table_name="npcs")
    op.drop_table("npcs")
