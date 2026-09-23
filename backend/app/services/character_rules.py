"""Regras puras do wizard de criação: atributos, bônus, HP, carga e espaços de magia.

Nada aqui toca o banco; tudo é dirigido pelo pacote de regras escolhido.
"""

import random
from collections.abc import Mapping, Sequence
from typing import Any

from app.models.enums import AttributeMethod
from app.rulesets.schema import RulesetPack
from app.services import dice

CUSTOM_KEY = "custom"


class RulesError(ValueError):
    pass


def modifier(pack: RulesetPack, score: int) -> int:
    if pack.modifier.strategy == "dnd":
        return (score - 10) // 2
    if pack.modifier.strategy == "raw":
        return score
    return 0


def _assign_by_priority(pack: RulesetPack, values: Sequence[int], class_key: str | None) -> dict[str, int]:
    order = pack.attribute_keys()
    if class_key:
        cls = pack.character_class(class_key)
        if cls is None:
            raise RulesError("Classe desconhecida para a geração automática.")
        order = cls.attribute_priority
    return dict(zip(order, sorted(values, reverse=True), strict=True))


def generate_base(
    pack: RulesetPack,
    method: AttributeMethod,
    *,
    class_key: str | None = None,
    scores: Mapping[str, int] | None = None,
    rng: random.Random | None = None,
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    """Retorna (atributos base, rolagens para auditoria)."""
    keys = pack.attribute_keys()
    gen = pack.generation

    if method is AttributeMethod.CLASS_PRESET:
        if gen.standard_array is None:
            raise RulesError("Este sistema não tem arranjo padrão para geração automática.")
        if not class_key or class_key == CUSTOM_KEY:
            raise RulesError("Escolha uma classe do sistema para gerar automaticamente.")
        return _assign_by_priority(pack, gen.standard_array, class_key), []

    if method is AttributeMethod.ROLL:
        if gen.roll is None:
            raise RulesError("Este sistema não usa rolagem de atributos.")
        expression = dice.parse(gen.roll)
        results = [dice.roll(expression, rng) for _ in keys]
        audit = [r.to_dict() for r in results]
        preset_class = class_key if class_key and class_key != CUSTOM_KEY else None
        return _assign_by_priority(pack, [r.total for r in results], preset_class), audit

    if scores is None or set(scores) != set(keys):
        raise RulesError("Informe um valor para cada atributo.")
    values = {k: int(scores[k]) for k in keys}

    if method is AttributeMethod.STANDARD_ARRAY:
        if gen.standard_array is None:
            raise RulesError("Este sistema não tem arranjo padrão.")
        if sorted(values.values()) != sorted(gen.standard_array):
            raise RulesError(f"Use exatamente os valores {gen.standard_array}.")
        return values, []

    if method is AttributeMethod.POINT_BUY:
        if gen.point_buy is None:
            raise RulesError("Este sistema não usa compra de pontos.")
        costs = gen.point_buy.costs
        if any(str(v) not in costs for v in values.values()):
            raise RulesError(f"Valores permitidos na compra de pontos: {', '.join(costs)}.")
        spent = sum(costs[str(v)] for v in values.values())
        if spent > gen.point_buy.budget:
            raise RulesError(f"Pontos gastos ({spent}) passam do orçamento ({gen.point_buy.budget}).")
        return values, []

    if method is AttributeMethod.MANUAL:
        if any(not gen.manual.min <= v <= gen.manual.max for v in values.values()):
            raise RulesError(f"Valores precisam estar entre {gen.manual.min} e {gen.manual.max}.")
        return values, []

    raise RulesError("Método de geração desconhecido.")


def point_buy_spent(pack: RulesetPack, scores: Mapping[str, int]) -> int:
    if pack.generation.point_buy is None:
        return 0
    costs = pack.generation.point_buy.costs
    return sum(costs.get(str(v), 0) for v in scores.values())


def compute_bonuses(
    pack: RulesetPack,
    *,
    ancestry_key: str | None,
    ancestry_choices: Sequence[str] = (),
    background_key: str | None = None,
    background_bonus: Mapping[str, int] | None = None,
) -> dict[str, int]:
    keys = set(pack.attribute_keys())
    bonuses: dict[str, int] = {}

    def add(attr: str, amount: int) -> None:
        bonuses[attr] = bonuses.get(attr, 0) + amount

    ancestry = pack.ancestry(ancestry_key) if ancestry_key else None
    if ancestry:
        for attr, amount in ancestry.bonuses.items():
            add(attr, amount)
        choice = ancestry.bonus_choices
        if choice and ancestry_choices:
            picked = list(ancestry_choices)
            if len(picked) != choice.count or len(set(picked)) != len(picked):
                raise RulesError(f"Escolha {choice.count} atributos diferentes para o bônus de {ancestry.name}.")
            if set(picked) - keys or set(picked) & set(choice.exclude):
                raise RulesError("Atributo inválido no bônus de raça.")
            for attr in picked:
                add(attr, choice.amount)

    if pack.background_bonus.strategy == "plus2_plus1" and background_bonus:
        background = pack.background(background_key) if background_key else None
        if background is None:
            raise RulesError("Escolha o antecedente antes de distribuir os bônus.")
        amounts = sorted(background_bonus.values(), reverse=True)
        if amounts not in ([2, 1], [1, 1, 1]):
            raise RulesError("Distribua +2/+1 ou +1/+1/+1.")
        if set(background_bonus) - set(background.bonus_options):
            raise RulesError(f"{background.name} só dá bônus em {', '.join(background.bonus_options)}.")
        for attr, amount in background_bonus.items():
            add(attr, amount)

    return bonuses


def final_attributes(base: Mapping[str, int], bonuses: Mapping[str, int]) -> dict[str, int]:
    return {k: v + bonuses.get(k, 0) for k, v in base.items()}


def compute_hp_max(
    pack: RulesetPack,
    *,
    class_key: str | None,
    ancestry_key: str | None,
    attributes: Mapping[str, int],
    level: int = 1,
) -> int:
    rule = pack.hp
    ancestry = pack.ancestry(ancestry_key) if ancestry_key else None
    ancestry_bonus = (ancestry.hp_bonus_per_level if ancestry else 0) * level

    if rule.strategy == "hit_die_max_plus_mod":
        cls = pack.character_class(class_key) if class_key else None
        if cls is None or cls.hit_die is None:
            raise RulesError("Escolha uma classe do sistema para calcular os pontos de vida.")
        mod = modifier(pack, attributes.get(rule.attribute or "", 10))
        # Nível 1: dado cheio. Níveis seguintes: média fixa (metade + 1), como no SRD.
        total = cls.hit_die + mod + (cls.hit_die // 2 + 1 + mod) * (level - 1) + ancestry_bonus
        return max(rule.minimum * level, total)
    if rule.strategy == "fixed":
        return max(rule.minimum, (rule.value or 0) + ancestry_bonus)
    return max(rule.minimum, rule.value or 10)


def carry_capacity(pack: RulesetPack, attributes: Mapping[str, int]) -> tuple[float, str]:
    rule = pack.carry
    if rule.strategy == "attribute_multiplier":
        return float(attributes.get(rule.attribute or "", 0) * (rule.multiplier or 0)), rule.unit
    return float(rule.value or 0), rule.unit


def initial_spell_slots(pack: RulesetPack, class_key: str | None) -> dict[str, dict[str, int]]:
    cls = pack.character_class(class_key) if class_key else None
    if cls is None:
        return {}
    return {level: {"max": count, "used": 0} for level, count in cls.spell_slots_level1.items()}


def missing_for_finalize(pack: RulesetPack, character: Any) -> list[str]:
    """Campos que ainda faltam para concluir o personagem (o app usa para destacar o passo)."""
    missing = []
    if not character.name.strip():
        missing.append("name")
    if pack.ancestries and not character.ancestry_key:
        missing.append("ancestry")
    if pack.classes and not character.class_key:
        missing.append("class")
    if set(character.attributes or {}) != set(pack.attribute_keys()):
        missing.append("attributes")
    if pack.backgrounds and not character.background_key:
        missing.append("background")
    ancestry = pack.ancestry(character.ancestry_key) if character.ancestry_key else None
    if ancestry and ancestry.bonus_choices and len(character.ancestry_choices or []) != ancestry.bonus_choices.count:
        missing.append("ancestry_choices")
    if (
        pack.background_bonus.strategy == "plus2_plus1"
        and character.background_key != CUSTOM_KEY
        and pack.background(character.background_key or "")
        and not character.background_bonus
    ):
        missing.append("background_bonus")
    if pack.hp.strategy == "hit_die_max_plus_mod" and (not character.class_key or character.class_key == CUSTOM_KEY):
        missing.append("class")
    return list(dict.fromkeys(missing))
