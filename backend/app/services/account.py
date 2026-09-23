"""Direitos do titular (LGPD art. 18 / GDPR): exportação e exclusão de conta, retenção de dados."""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings
from app.models import Character, Npc, RefreshToken, Room, RoomMember, Scene, SessionEvent, User, UserBlock
from app.services.media import MediaStore


async def export_user_data(session: AsyncSession, user: User) -> dict[str, Any]:
    characters = (
        await session.scalars(
            select(Character)
            .where(Character.owner_id == user.id)
            .options(selectinload(Character.items), selectinload(Character.abilities))
        )
    ).all()
    memberships = (await session.scalars(select(RoomMember).where(RoomMember.user_id == user.id))).all()
    events = (await session.scalars(select(SessionEvent).where(SessionEvent.actor_user_id == user.id))).all()
    blocks = (await session.scalars(select(UserBlock).where(UserBlock.blocker_id == user.id))).all()

    def iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    return {
        "exported_at": datetime.now(UTC).isoformat(),
        "user": {
            "id": str(user.id),
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name,
            "locale": user.locale,
            "created_at": iso(user.created_at),
        },
        "characters": [
            {
                "id": str(c.id),
                "ruleset_id": c.ruleset_id,
                "name": c.name,
                "ancestry": c.ancestry_name,
                "class": c.class_name,
                "background": c.background_name,
                "level": c.level,
                "attributes": c.attributes,
                "hp": {"max": c.hp_max, "current": c.hp_current, "temp": c.hp_temp},
                "spell_slots": c.spell_slots,
                "notes": c.notes,
                "portrait_key": c.portrait_key,
                "items": [
                    {"name": i.name, "quantity": i.quantity, "weight_each": str(i.weight_each), "equipped": i.equipped}
                    for i in c.items
                ],
                "abilities": [
                    {"name": a.name, "level": a.level, "uses_max": a.uses_max, "recharge": a.recharge.value}
                    for a in c.abilities
                ],
            }
            for c in characters
        ],
        "rooms": [
            {"room_id": str(m.room_id), "role": m.role.value, "joined_at": iso(m.joined_at)} for m in memberships
        ],
        "session_events": [
            {"room_id": str(e.room_id), "type": e.type.value, "payload": e.payload, "created_at": iso(e.created_at)}
            for e in events
        ],
        "blocked_users": [str(b.blocked_id) for b in blocks],
    }


async def delete_room_media(session: AsyncSession, room_id, media: MediaStore) -> None:  # noqa: ANN001
    keys = [k for k in (await session.scalars(select(Scene.map_key).where(Scene.room_id == room_id))).all() if k]
    keys += [k for k in (await session.scalars(select(Npc.portrait_key).where(Npc.room_id == room_id))).all() if k]
    for key in set(keys):
        await media.delete(key)


async def delete_account(session: AsyncSession, user: User, media: MediaStore) -> None:
    """Exclusão imediata do conteúdo e anonimização da conta; a linha some no expurgo (purge_deleted)."""
    now = datetime.now(UTC)
    characters = (await session.scalars(select(Character).where(Character.owner_id == user.id))).all()
    for character in characters:
        if character.portrait_key:
            await media.delete(character.portrait_key)
        await session.delete(character)
    # Campanhas mestradas por quem sai são apagadas com mapas e imagens de inimigos.
    for room in (await session.scalars(select(Room).where(Room.master_id == user.id))).all():
        await delete_room_media(session, room.id, media)
        await session.delete(room)
    await session.execute(delete(RoomMember).where(RoomMember.user_id == user.id))
    await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id))
    await session.execute(
        delete(UserBlock).where((UserBlock.blocker_id == user.id) | (UserBlock.blocked_id == user.id))
    )
    await session.execute(update(SessionEvent).where(SessionEvent.actor_user_id == user.id).values(actor_user_id=None))

    user.username = f"excluido-{user.id.hex[:12]}"
    user.email = None
    user.display_name = "Conta excluída"
    user.password_hash = "!"
    user.deleted_at = now
    await session.commit()


async def purge(session: AsyncSession, settings: Settings, media: MediaStore | None = None) -> dict[str, int]:
    """Rotina de retenção (`rpgplay-server purge`, agendada pelo timer do systemd)."""
    now = datetime.now(UTC)
    events = await session.execute(
        delete(SessionEvent).where(SessionEvent.created_at < now - timedelta(days=settings.event_retention_days))
    )
    users = await session.execute(
        delete(User).where(
            User.deleted_at.is_not(None), User.deleted_at < now - timedelta(days=settings.account_purge_days)
        )
    )
    # Campanhas não expiram; só somem depois de muito tempo sem nenhuma atividade.
    stale = (
        await session.scalars(
            select(Room).where(Room.last_activity_at < now - timedelta(days=settings.room_retention_days))
        )
    ).all()
    for room in stale:
        if media is not None:
            await delete_room_media(session, room.id, media)
        await session.delete(room)
    await session.commit()
    return {"events": events.rowcount or 0, "users": users.rowcount or 0, "rooms_deleted": len(stale)}
