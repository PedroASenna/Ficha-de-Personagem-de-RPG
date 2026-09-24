"""cenário com várias imagens, objetos que carregam bonecos, névoa de guerra, mapa-múndi e nível

- scene_images: peças de cenário (várias por cena), com rotação e ordem de empilhamento
- scene_objects: carroça/barco/jaula; tokens.container_id diz quem está dentro
- tokens.rotation; scenes.fog_enabled/fog_radius; fog_explored: o que cada personagem já explorou
- rooms.world_*: mapa-múndi; factions e faction_relations: nações, facções e relações
- characters.ancestry_bonus: pontos digitados à mão para raça personalizada (sistema genérico)

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-24 02:19:04.142023+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def _created_at() -> sa.Column:
    return sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def _updated_at() -> sa.Column:
    return sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        "factions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind", sa.Enum("nation", "faction", name="factionkind", native_enum=False, length=32), nullable=False
        ),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("emblem_key", sa.String(length=255), nullable=True),
        sa.Column("color", sa.String(length=7), nullable=False),
        sa.Column("leader", sa.String(length=80), nullable=False),
        sa.Column("seat", sa.String(length=80), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("secret_notes", sa.Text(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("revealed", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        _created_at(),
        _updated_at(),
        sa.ForeignKeyConstraint(
            ["parent_id"], ["factions.id"], name=op.f("fk_factions_parent_id_factions"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], name=op.f("fk_factions_room_id_rooms"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_factions")),
    )
    op.create_index(op.f("ix_factions_room_id"), "factions", ["room_id"], unique=False)

    op.create_table(
        "faction_relations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("a_id", sa.Uuid(), nullable=False),
        sa.Column("b_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "alliance", "friendly", "neutral", "tense", "war", name="relationkind", native_enum=False, length=32
            ),
            nullable=False,
        ),
        sa.Column("note", sa.String(length=200), nullable=False),
        sa.Column("revealed", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint("a_id <> b_id", name=op.f("ck_faction_relations_distinct_pair")),
        sa.ForeignKeyConstraint(
            ["a_id"], ["factions.id"], name=op.f("fk_faction_relations_a_id_factions"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["b_id"], ["factions.id"], name=op.f("fk_faction_relations_b_id_factions"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["room_id"], ["rooms.id"], name=op.f("fk_faction_relations_room_id_rooms"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_faction_relations")),
        sa.UniqueConstraint("a_id", "b_id", name="uq_faction_relations_pair"),
    )
    op.create_index(op.f("ix_faction_relations_room_id"), "faction_relations", ["room_id"], unique=False)

    op.create_table(
        "fog_explored",
        sa.Column("scene_id", sa.Uuid(), nullable=False),
        sa.Column("character_id", sa.Uuid(), nullable=False),
        sa.Column("cols", sa.Integer(), nullable=False),
        sa.Column("rows", sa.Integer(), nullable=False),
        sa.Column("cell", sa.Float(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        _updated_at(),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["characters.id"],
            name=op.f("fk_fog_explored_character_id_characters"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["scene_id"], ["scenes.id"], name=op.f("fk_fog_explored_scene_id_scenes"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("scene_id", "character_id", name=op.f("pk_fog_explored")),
    )

    for table, extra in (
        (
            "scene_images",
            [
                sa.Column("image_key", sa.String(length=255), nullable=False),
                sa.Column("x", sa.Float(), nullable=False),
                sa.Column("y", sa.Float(), nullable=False),
                sa.Column("width", sa.Float(), nullable=False),
                sa.Column("height", sa.Float(), nullable=False),
                sa.Column("rotation", sa.Float(), nullable=False),
                sa.Column("z", sa.Integer(), nullable=False),
                sa.Column("locked", sa.Boolean(), nullable=False),
            ],
        ),
        (
            "scene_objects",
            [
                sa.Column("name", sa.String(length=60), nullable=False),
                sa.Column("image_key", sa.String(length=255), nullable=True),
                sa.Column("x", sa.Float(), nullable=False),
                sa.Column("y", sa.Float(), nullable=False),
                sa.Column("width", sa.Float(), nullable=False),
                sa.Column("height", sa.Float(), nullable=False),
                sa.Column("rotation", sa.Float(), nullable=False),
                sa.Column("z", sa.Integer(), nullable=False),
                sa.Column("hide_occupants", sa.Boolean(), nullable=False),
            ],
        ),
    ):
        op.create_table(
            table,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("room_id", sa.Uuid(), nullable=False),
            sa.Column("scene_id", sa.Uuid(), nullable=False),
            *extra,
            sa.Column("version", sa.Integer(), nullable=False),
            _created_at(),
            sa.ForeignKeyConstraint(
                ["room_id"], ["rooms.id"], name=op.f(f"fk_{table}_room_id_rooms"), ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["scene_id"], ["scenes.id"], name=op.f(f"fk_{table}_scene_id_scenes"), ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{table}")),
        )
        op.create_index(op.f(f"ix_{table}_scene_id"), table, ["scene_id"], unique=False)

    # Colunas novas em tabelas com dados: o server_default preenche as linhas que já existem.
    with op.batch_alter_table("characters", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ancestry_bonus", JSON, server_default=sa.text("'{}'"), nullable=False))

    with op.batch_alter_table("rooms", schema=None) as batch_op:
        batch_op.add_column(sa.Column("world_map_key", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("world_map_width", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("world_map_height", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("world_visible", sa.Boolean(), server_default=sa.false(), nullable=False))

    with op.batch_alter_table("scenes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("fog_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column("fog_radius", sa.Integer(), server_default="4", nullable=False))

    with op.batch_alter_table("tokens", schema=None) as batch_op:
        batch_op.add_column(sa.Column("rotation", sa.Float(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("container_id", sa.Uuid(), nullable=True))
        batch_op.create_index("ix_tokens_container", ["container_id"], unique=False)
        batch_op.create_foreign_key(
            batch_op.f("fk_tokens_container_id_scene_objects"),
            "scene_objects",
            ["container_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("tokens", schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f("fk_tokens_container_id_scene_objects"), type_="foreignkey")
        batch_op.drop_index("ix_tokens_container")
        batch_op.drop_column("container_id")
        batch_op.drop_column("rotation")

    with op.batch_alter_table("scenes", schema=None) as batch_op:
        batch_op.drop_column("fog_radius")
        batch_op.drop_column("fog_enabled")

    with op.batch_alter_table("rooms", schema=None) as batch_op:
        batch_op.drop_column("world_visible")
        batch_op.drop_column("world_map_height")
        batch_op.drop_column("world_map_width")
        batch_op.drop_column("world_map_key")

    with op.batch_alter_table("characters", schema=None) as batch_op:
        batch_op.drop_column("ancestry_bonus")

    for table in ("scene_objects", "scene_images"):
        op.drop_index(op.f(f"ix_{table}_scene_id"), table_name=table)
        op.drop_table(table)
    op.drop_table("fog_explored")
    op.drop_index(op.f("ix_faction_relations_room_id"), table_name="faction_relations")
    op.drop_table("faction_relations")
    op.drop_index(op.f("ix_factions_room_id"), table_name="factions")
    op.drop_table("factions")
