"""Casos de uso da ficha: wizard (rascunho → completo), HP, descanso, inventário."""

import random
import secrets
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ConflictError, DomainError, NotFoundError
from app.models import Character, User
from app.models.enums import AttributeMethod, CharacterStatus, Recharge
from app.rulesets.loader import RulesetRegistry
from app.rulesets.schema import RulesetPack
from app.schemas.characters import (
    AbilityOut,
    CharacterOut,
    CharacterPatch,
    CharacterQuickCreate,
    ItemOut,
    LoadOut,
)
from app.services import character_rules as rules
from app.services.character_rules import CUSTOM_KEY
from app.services.hp import apply_hp
from app.services.media import MediaStore

_rng = secrets.SystemRandom()


def _load_options():
    return (selectinload(Character.items), selectinload(Character.abilities))


async def get_character(session: AsyncSession, character_id: uuid.UUID) -> Character | None:
    return await session.scalar(select(Character).where(Character.id == character_id).options(*_load_options()))


async def get_owned(session: AsyncSession, user: User, character_id: uuid.UUID) -> Character:
    character = await get_character(session, character_id)
    if character is None or character.owner_id != user.id:
        raise NotFoundError("Personagem não encontrado.")
    return character


def pack_for(registry: RulesetRegistry, ruleset_id: str) -> RulesetPack:
    pack = registry.get(ruleset_id)
    if pack is None or pack.status != "available":
        raise DomainError("Sistema de regras indisponível.")
    return pack


def _recompute_attributes(pack: RulesetPack, character: Character) -> None:
    base = (character.attribute_audit or {}).get("base")
    if not base:
        return
    bonuses = _bonuses(pack, character)
    # advancement = pontos ganhos ao subir de nível (somados por cima de base + raça/antecedente).
    advancement = character.attribute_audit.get("advancement") or {}
    character.attributes = rules.final_attributes(base, rules.combine(bonuses, advancement))
    character.attribute_audit = {**character.attribute_audit, "bonuses": bonuses}


def _bonuses(pack: RulesetPack, character: Character) -> dict[str, int]:
    return rules.compute_bonuses(
        pack,
        ancestry_key=character.ancestry_key,
        ancestry_choices=character.ancestry_choices or [],
        ancestry_bonus=character.ancestry_bonus or {},
        background_key=character.background_key,
        background_bonus=character.background_bonus or {},
    )


def _recompute_hp(pack: RulesetPack, character: Character) -> None:
    """Depois de concluído, mudanças de classe/CON/nível ajustam o PV máximo mantendo o dano sofrido."""
    if character.status != CharacterStatus.COMPLETE or pack.hp.strategy != "hit_die_max_plus_mod":
        return
    new_max = rules.compute_hp_max(
        pack,
        class_key=character.class_key,
        ancestry_key=character.ancestry_key,
        attributes=character.attributes,
        level=character.level,
    )
    diff = new_max - character.hp_max
    character.hp_max = new_max
    character.hp_current = max(0, min(new_max, character.hp_current + diff))


def _set_choice(
    pack: RulesetPack, kind: str, key: str | None, custom_name: str | None
) -> tuple[str | None, str | None]:
    """Valida a chave de raça/classe/antecedente e devolve (key, nome exibido)."""
    if key is None:
        return None, None
    if key == CUSTOM_KEY:
        if not pack.allow_custom:
            raise DomainError("Este sistema não aceita opções personalizadas.")
        name = (custom_name or "").strip()
        if not name:
            raise DomainError("Dê um nome para a opção personalizada.")
        return key, name[:60]
    lookup = {"ancestry": pack.ancestry, "class": pack.character_class, "background": pack.background}[kind]
    item = lookup(key)
    if item is None:
        raise DomainError("Opção inexistente neste sistema de regras.")
    return key, item.name


def apply_patch(pack: RulesetPack, character: Character, patch: CharacterPatch) -> None:
    data = patch.model_dump(exclude_unset=True)

    for field in ("name", "portrait_key", "notes", "conditions", "wizard_step"):
        if field in data and data[field] is not None:
            setattr(character, field, data[field].strip() if field == "name" else data[field])

    if "ancestry_key" in data:
        new_key, name = _set_choice(pack, "ancestry", data["ancestry_key"], data.get("ancestry_name"))
        if new_key != character.ancestry_key:
            character.ancestry_choices = []
            character.ancestry_bonus = {}
        character.ancestry_key, character.ancestry_name = new_key, name
    if data.get("ancestry_choices") is not None:
        character.ancestry_choices = data["ancestry_choices"]
    if data.get("ancestry_bonus") is not None:
        character.ancestry_bonus = data["ancestry_bonus"]
    if "class_key" in data:
        character.class_key, character.class_name = _set_choice(
            pack, "class", data["class_key"], data.get("class_name")
        )
    if "background_key" in data:
        new_key, name = _set_choice(pack, "background", data["background_key"], data.get("background_name"))
        if new_key != character.background_key:
            character.background_bonus = {}
        character.background_key, character.background_name = new_key, name
    if data.get("background_bonus") is not None:
        character.background_bonus = data["background_bonus"]
    if data.get("level") is not None:
        character.level = data["level"]

    # Valida as escolhas de bônus mesmo antes de haver atributos base.
    _bonuses(pack, character)
    _recompute_attributes(pack, character)
    _recompute_hp(pack, character)

    if data.get("hp_max") is not None:
        if pack.hp.strategy == "hit_die_max_plus_mod":
            raise DomainError("Neste sistema o PV máximo é calculado pela classe e Constituição.")
        diff = data["hp_max"] - character.hp_max
        character.hp_max = data["hp_max"]
        character.hp_current = max(0, min(character.hp_max, character.hp_current + diff))
    character.version += 1


def generate_attributes(
    pack: RulesetPack,
    character: Character,
    method: AttributeMethod,
    scores: dict[str, int] | None,
    rng: random.Random | None = None,
) -> None:
    base, rolls = rules.generate_base(pack, method, class_key=character.class_key, scores=scores, rng=rng)
    character.attribute_method = method
    kept = {k: v for k, v in (character.attribute_audit or {}).items() if k in ("advancement", "level_ups")}
    character.attribute_audit = {"method": method.value, "base": base, "rolls": rolls, **kept}
    _recompute_attributes(pack, character)
    _recompute_hp(pack, character)
    character.version += 1


def finalize(pack: RulesetPack, character: Character) -> None:
    missing = rules.missing_for_finalize(pack, character)
    if missing:
        raise DomainError(f"Faltam dados para concluir: {', '.join(missing)}.")
    character.hp_max = rules.compute_hp_max(
        pack,
        class_key=character.class_key,
        ancestry_key=character.ancestry_key,
        attributes=character.attributes,
        level=character.level,
    )
    if character.status != CharacterStatus.COMPLETE:
        character.hp_current = character.hp_max
        character.spell_slots = rules.initial_spell_slots(pack, character.class_key)
    character.hp_current = min(character.hp_current, character.hp_max)
    character.status = CharacterStatus.COMPLETE
    character.version += 1


def new_character(pack: RulesetPack, owner: User, name: str = "") -> Character:
    """Rascunho com todos os defaults preenchidos (o SQLAlchemy só aplica defaults no INSERT)."""
    return Character(
        owner_id=owner.id,
        ruleset_id=pack.id,
        ruleset_version=pack.version,
        status=CharacterStatus.DRAFT,
        wizard_step=0,
        name=name.strip(),
        ancestry_choices=[],
        ancestry_bonus={},
        background_bonus={},
        level=1,
        attributes={},
        attribute_audit={},
        hp_max=0,
        hp_current=0,
        hp_temp=0,
        spell_slots={},
        conditions=[],
        notes="",
        version=1,
    )


def quick_create(
    pack: RulesetPack, owner: User, data: CharacterQuickCreate, rng: random.Random | None = None
) -> Character:
    rng = rng or _rng
    character = new_character(pack, owner, data.name)
    ancestry = data.ancestry_key or (rng.choice(pack.ancestries).key if pack.ancestries else None)
    cls = data.class_key or (rng.choice(pack.classes).key if pack.classes else None)
    background = data.background_key or (rng.choice(pack.backgrounds).key if pack.backgrounds else None)
    patch: dict[str, Any] = {"ancestry_key": ancestry, "class_key": cls, "background_key": background}
    # Sistemas em que raça/origem são digitadas: nome padrão, sem pontos (o jogador ajusta depois).
    if ancestry is None and "ancestry" in pack.custom_required:
        patch |= {"ancestry_key": CUSTOM_KEY, "ancestry_name": data.ancestry_name or "Humano"}
    if background is None and "background" in pack.custom_required:
        patch |= {"background_key": CUSTOM_KEY, "background_name": data.background_name or "Aventureiro"}
    apply_patch(pack, character, CharacterPatch(**patch))

    anc = pack.ancestry(ancestry) if ancestry else None
    class_def = pack.character_class(cls) if cls else None
    priority = class_def.attribute_priority if class_def else pack.attribute_keys()
    if anc and anc.bonus_choices:
        options = [k for k in priority if k not in anc.bonus_choices.exclude]
        character.ancestry_choices = options[: anc.bonus_choices.count]
    bg = pack.background(background) if background else None
    if pack.background_bonus.strategy == "plus2_plus1" and bg:
        ordered = [k for k in priority if k in bg.bonus_options]
        character.background_bonus = {ordered[0]: 2, ordered[1]: 1}

    method = AttributeMethod.CLASS_PRESET if pack.generation.standard_array and class_def else AttributeMethod.ROLL
    generate_attributes(pack, character, method, None, rng)
    finalize(pack, character)
    character.wizard_step = 5
    return character


def level_up(
    pack: RulesetPack, character: Character, increases: dict[str, int], hp_gain: int | None
) -> dict[str, Any]:
    """Sobe um nível: PV pela classe (5ª edição) ou digitados; pontos de atributo onde o sistema dá."""
    if character.status != CharacterStatus.COMPLETE:
        raise DomainError("Conclua o personagem antes de subir de nível.")
    new_level, points = rules.validate_level_up(
        pack, level=character.level, attributes=character.attributes or {}, increases=increases, hp_gain=hp_gain
    )
    hp_before = character.hp_max
    audit = dict(character.attribute_audit or {})
    audit["advancement"] = rules.combine(audit.get("advancement") or {}, points)
    audit["level_ups"] = [*(audit.get("level_ups") or []), {"level": new_level, "attributes": points, "hp": hp_gain}]
    character.attribute_audit = audit
    character.level = new_level
    if audit.get("base"):
        _recompute_attributes(pack, character)
    else:
        character.attributes = rules.combine(character.attributes or {}, points)
    if hp_gain is None:
        _recompute_hp(pack, character)
    else:
        character.hp_max += hp_gain
        character.hp_current = min(character.hp_max, character.hp_current + hp_gain)
    character.version += 1
    return {"level": new_level, "hp_gain": character.hp_max - hp_before, "attributes": points}


def level_summary(pack: RulesetPack, name: str, result: dict[str, Any]) -> str:
    abbr = {a.key: a.abbr for a in pack.attributes}
    parts = [f"+{result['hp_gain']} PV"] if result["hp_gain"] else []
    parts += [f"{abbr.get(k, k)} +{v}" for k, v in result["attributes"].items()]
    extra = f" ({', '.join(parts)})" if parts else ""
    return f"{name} subiu para o nível {result['level']}!{extra}"


def apply_hp_change(character: Character, delta: int, kind: str, expected_version: int | None) -> dict[str, Any]:
    if character.status != CharacterStatus.COMPLETE:
        raise DomainError("Conclua o personagem antes de usar o HUD de combate.")
    return {"character_id": character.id, **apply_hp(character, delta, kind, expected_version)}


def rest(character: Character, rest_type: str) -> None:
    if character.status != CharacterStatus.COMPLETE:
        raise DomainError("Conclua o personagem antes de descansar.")
    recharges = {Recharge.SHORT_REST}
    if rest_type == "long":
        recharges.add(Recharge.LONG_REST)
        character.hp_current = character.hp_max
        character.hp_temp = 0
        character.spell_slots = {lvl: {**slot, "used": 0} for lvl, slot in (character.spell_slots or {}).items()}
    for ability in character.abilities:
        if ability.recharge in recharges:
            ability.uses_spent = 0
    character.version += 1


def use_spell_slot(character: Character, level: str) -> None:
    slot = (character.spell_slots or {}).get(level)
    if slot is None:
        raise DomainError("Sem espaços de magia desse círculo.")
    if slot["used"] >= slot["max"]:
        raise ConflictError("Espaços de magia esgotados até o próximo descanso longo.")
    character.spell_slots = {**character.spell_slots, level: {**slot, "used": slot["used"] + 1}}
    character.version += 1


def load_summary(pack: RulesetPack, character: Character) -> LoadOut:
    total = sum((item.weight_each or Decimal(0)) * item.quantity for item in character.items)
    capacity, unit = rules.carry_capacity(pack, character.attributes or {})
    total_f = float(total)
    ratio = total_f / capacity if capacity else 0.0
    return LoadOut(
        total_weight=round(total_f, 2), capacity=capacity, unit=unit, encumbered=ratio > 1, ratio=round(ratio, 3)
    )


def to_out(pack: RulesetPack, character: Character, media: MediaStore) -> CharacterOut:
    attributes = character.attributes or {}
    return CharacterOut(
        id=character.id,
        ruleset_id=character.ruleset_id,
        ruleset_version=character.ruleset_version,
        status=character.status,
        wizard_step=character.wizard_step,
        missing=rules.missing_for_finalize(pack, character) if character.status == CharacterStatus.DRAFT else [],
        name=character.name,
        portrait_key=character.portrait_key,
        portrait_url=media.url(character.portrait_key) if character.portrait_key else None,
        ancestry_key=character.ancestry_key,
        ancestry_name=character.ancestry_name,
        ancestry_choices=character.ancestry_choices or [],
        ancestry_bonus=character.ancestry_bonus or {},
        class_key=character.class_key,
        class_name=character.class_name,
        background_key=character.background_key,
        background_name=character.background_name,
        background_bonus=character.background_bonus or {},
        level=character.level,
        attributes=attributes,
        modifiers={k: rules.modifier(pack, v) for k, v in attributes.items()},
        attribute_method=character.attribute_method,
        attribute_audit=character.attribute_audit or {},
        hp_max=character.hp_max,
        hp_current=character.hp_current,
        hp_temp=character.hp_temp,
        spell_slots=character.spell_slots or {},
        conditions=character.conditions or [],
        notes=character.notes,
        version=character.version,
        items=[ItemOut.model_validate(i) for i in character.items],
        abilities=[
            AbilityOut(
                id=a.id,
                name=a.name,
                level=a.level,
                uses_max=a.uses_max,
                uses_spent=a.uses_spent,
                recharge=a.recharge,
                available=a.uses_spent < a.uses_max,
            )
            for a in character.abilities
        ],
        load=load_summary(pack, character),
        updated_at=character.updated_at,
    )
