import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AppState, get_current_user, get_db, get_state
from app.core.errors import ConflictError, NotFoundError
from app.models import Character, CharacterAbility, InventoryItem, User
from app.models.enums import SessionEventType
from app.schemas.characters import (
    AbilityIn,
    AdvanceIn,
    AttributeGenerateIn,
    CharacterCreate,
    CharacterOut,
    CharacterPatch,
    CharacterQuickCreate,
    HpChangeIn,
    HpTransitionOut,
    ItemIn,
    ItemPatch,
    LevelUpIn,
    RestIn,
)
from app.services import characters as service
from app.services.engines.savage import AdvanceIn as SavageAdvance
from app.ws.events import announce_hp_change, announce_level_up, rooms_with_character

router = APIRouter(prefix="/characters", tags=["personagens"])


async def _reload(db: AsyncSession, character_id: uuid.UUID) -> Character:
    character = await db.scalar(
        select(Character)
        .where(Character.id == character_id)
        .options(selectinload(Character.items), selectinload(Character.abilities))
        .execution_options(populate_existing=True)
    )
    if character is None:
        raise NotFoundError("Personagem não encontrado.")
    return character


async def _out(db: AsyncSession, state: AppState, character_id: uuid.UUID) -> CharacterOut:
    character = await _reload(db, character_id)
    return service.to_out(service.pack_for(state.registry, character.ruleset_id), character, state.media)


@router.get("", response_model=list[CharacterOut])
async def list_characters(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), state: AppState = Depends(get_state)
):
    rows = await db.scalars(
        select(Character)
        .where(Character.owner_id == user.id)
        .options(selectinload(Character.items), selectinload(Character.abilities))
        .order_by(Character.updated_at.desc())
    )
    return [service.to_out(service.pack_for(state.registry, c.ruleset_id), c, state.media) for c in rows]


@router.post("", response_model=CharacterOut, status_code=status.HTTP_201_CREATED)
async def create_character(
    data: CharacterCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Cria o rascunho do wizard (passo 0)."""
    pack = service.pack_for(state.registry, data.ruleset_id)
    character = service.new_character(pack, user, data.name)
    db.add(character)
    await db.commit()
    return await _out(db, state, character.id)


@router.post("/quick", response_model=CharacterOut, status_code=status.HTTP_201_CREATED)
async def quick_create(
    data: CharacterQuickCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Personagem pronto em um toque (raça/classe sorteadas se não informadas, atributos pela classe)."""
    pack = service.pack_for(state.registry, data.ruleset_id)
    character = service.quick_create(pack, user, data)
    db.add(character)
    await db.commit()
    return await _out(db, state, character.id)


@router.get("/{character_id}", response_model=CharacterOut)
async def read_character(
    character_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    character = await service.get_owned(db, user, character_id)
    return service.to_out(service.pack_for(state.registry, character.ruleset_id), character, state.media)


@router.patch("/{character_id}", response_model=CharacterOut)
async def update_character(
    character_id: uuid.UUID,
    data: CharacterPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Cada passo do wizard salva aqui (autosave do rascunho)."""
    character = await service.get_owned(db, user, character_id)
    service.apply_patch(service.pack_for(state.registry, character.ruleset_id), character, data)
    await db.commit()
    return await _out(db, state, character_id)


@router.post("/{character_id}/attributes", response_model=CharacterOut)
async def generate_attributes(
    character_id: uuid.UUID,
    data: AttributeGenerateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Gera atributos: arranjo padrão, compra de pontos, rolagem (no servidor), preset da classe ou manual."""
    character = await service.get_owned(db, user, character_id)
    service.generate_attributes(
        service.pack_for(state.registry, character.ruleset_id), character, data.method, data.scores
    )
    await db.commit()
    return await _out(db, state, character_id)


@router.post("/{character_id}/finalize", response_model=CharacterOut)
async def finalize_character(
    character_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    character = await service.get_owned(db, user, character_id)
    service.finalize(service.pack_for(state.registry, character.ruleset_id), character)
    await db.commit()
    return await _out(db, state, character_id)


@router.delete("/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_character(
    character_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    character = await service.get_owned(db, user, character_id)
    if character.portrait_key:
        await state.media.delete(character.portrait_key)
    await db.delete(character)
    await db.commit()


@router.post("/{character_id}/hp", response_model=HpTransitionOut)
async def change_hp(
    character_id: uuid.UUID,
    data: HpChangeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Dano/cura pela ficha. Se o personagem estiver numa mesa aberta, o Mestre é notificado igual ao WebSocket."""
    character = await service.get_owned(db, user, character_id)
    transition = service.apply_hp_change(character, data.delta, data.kind, data.expected_version)
    rooms = [r.id for r in await rooms_with_character(db, character.id)]
    if rooms:
        await announce_hp_change(
            db,
            state.broadcaster,
            room_ids=rooms,
            actor_id=user.id,
            actor_name=user.display_name,
            character=character,
            transition=transition,
        )
    else:
        await db.commit()
    return HpTransitionOut(**transition)


@router.post("/{character_id}/rest", response_model=CharacterOut)
async def take_rest(
    character_id: uuid.UUID,
    data: RestIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Descanso curto recarrega habilidades de descanso curto; o longo recupera PV e espaços de magia."""
    character = await service.get_owned(db, user, character_id)
    before = character.hp_current
    service.rest(character, data.type)
    rooms = [r.id for r in await rooms_with_character(db, character.id)]
    if rooms:
        transition = {
            "character_id": character.id,
            "kind": "rest",
            "delta": character.hp_current - before,
            "hp_before": before,
            "hp_current": character.hp_current,
            "hp_max": character.hp_max,
            "hp_temp": character.hp_temp,
            "absorbed_by_temp": 0,
            "effect": "heal_glow",
            "version": character.version,
            "rest": data.type,
        }
        await announce_hp_change(
            db,
            state.broadcaster,
            room_ids=rooms,
            actor_id=user.id,
            actor_name=user.display_name,
            character=character,
            transition=transition,
            event_type=SessionEventType.REST,
        )
    else:
        await db.commit()
    return await _out(db, state, character_id)


async def level_up_and_announce(
    db: AsyncSession, state: AppState, user: User, character: Character, data: LevelUpIn
) -> None:
    """Usado pela ficha (dono) e pela mesa (Mestre): sobe o nível, grava no log e avisa as mesas abertas."""
    if data.expected_version is not None and data.expected_version != character.version:
        raise ConflictError("A ficha mudou enquanto você editava. Confira o nível atual.")
    pack = service.pack_for(state.registry, character.ruleset_id)
    if data.experience is not None:
        result = service.gain_experience(pack, character, data.experience)
        summary = result["summary"]
    else:
        result = service.level_up(pack, character, data.attributes, data.hp_gain)
        summary = service.level_summary(pack, character.name, result)
    await _announce_progress(db, state, user, pack, character, result, summary)


async def _announce_progress(
    db: AsyncSession, state: AppState, user: User, pack, character: Character, result: dict, summary: str
) -> None:
    rooms = [r.id for r in await rooms_with_character(db, character.id)]
    if not rooms:
        await db.commit()
        return
    await announce_level_up(
        db,
        state.broadcaster,
        room_ids=rooms,
        actor_id=user.id,
        character=character,
        result={**result, "level_label": service.level_label(pack, character)},
        summary=summary,
    )


@router.post("/{character_id}/level-up", response_model=CharacterOut)
async def level_up(
    character_id: uuid.UUID,
    data: LevelUpIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Sobe um nível: PV pela classe (5ª edição) ou os que o jogador informar; pontos de atributo onde o sistema dá."""
    character = await service.get_owned(db, user, character_id)
    await level_up_and_announce(db, state, user, character, data)
    return await _out(db, state, character_id)


@router.post("/{character_id}/advance", response_model=CharacterOut)
async def advance(
    character_id: uuid.UUID,
    data: AdvanceIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Progresso do Savage Worlds: nova Vantagem, atributo, perícias ou perícia nova."""
    character = await service.get_owned(db, user, character_id)
    if data.expected_version is not None and data.expected_version != character.version:
        raise ConflictError("A ficha mudou enquanto você escolhia. Confira e tente de novo.")
    pack = service.pack_for(state.registry, character.ruleset_id)
    choice = SavageAdvance(**data.model_dump(exclude={"expected_version"}))
    result = service.advance(pack, character, choice)
    await _announce_progress(db, state, user, pack, character, result, result["summary"])
    return await _out(db, state, character_id)


@router.post("/{character_id}/spell-slots/{level}/use", response_model=CharacterOut)
async def use_spell_slot(
    character_id: uuid.UUID,
    level: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    character = await service.get_owned(db, user, character_id)
    service.use_spell_slot(character, level)
    await db.commit()
    return await _out(db, state, character_id)


@router.post("/{character_id}/items", response_model=CharacterOut, status_code=status.HTTP_201_CREATED)
async def add_item(
    character_id: uuid.UUID,
    data: ItemIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    character = await service.get_owned(db, user, character_id)
    db.add(InventoryItem(character_id=character.id, **data.model_dump()))
    character.version += 1
    await db.commit()
    return await _out(db, state, character_id)


@router.patch("/{character_id}/items/{item_id}", response_model=CharacterOut)
async def update_item(
    character_id: uuid.UUID,
    item_id: uuid.UUID,
    data: ItemPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    character = await service.get_owned(db, user, character_id)
    item = next((i for i in character.items if i.id == item_id), None)
    if item is None:
        raise NotFoundError("Item não encontrado.")
    for key, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(item, key, value)
    character.version += 1
    await db.commit()
    return await _out(db, state, character_id)


@router.delete("/{character_id}/items/{item_id}", response_model=CharacterOut)
async def delete_item(
    character_id: uuid.UUID,
    item_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    character = await service.get_owned(db, user, character_id)
    item = next((i for i in character.items if i.id == item_id), None)
    if item is None:
        raise NotFoundError("Item não encontrado.")
    character.items.remove(item)
    character.version += 1
    await db.commit()
    return await _out(db, state, character_id)


@router.post("/{character_id}/abilities", response_model=CharacterOut, status_code=status.HTTP_201_CREATED)
async def add_ability(
    character_id: uuid.UUID,
    data: AbilityIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    character = await service.get_owned(db, user, character_id)
    db.add(CharacterAbility(character_id=character.id, **data.model_dump()))
    character.version += 1
    await db.commit()
    return await _out(db, state, character_id)


@router.post("/{character_id}/abilities/{ability_id}/use", response_model=CharacterOut)
async def use_ability(
    character_id: uuid.UUID,
    ability_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Gasta um uso; quando acabam, o app mostra o botão cinza até o descanso certo."""
    character = await service.get_owned(db, user, character_id)
    ability = next((a for a in character.abilities if a.id == ability_id), None)
    if ability is None:
        raise NotFoundError("Habilidade não encontrada.")
    if ability.uses_spent >= ability.uses_max:
        raise ConflictError("Sem usos restantes até o próximo descanso.")
    ability.uses_spent += 1
    character.version += 1
    await db.commit()
    return await _out(db, state, character_id)
