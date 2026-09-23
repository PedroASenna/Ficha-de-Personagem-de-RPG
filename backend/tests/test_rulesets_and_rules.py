import random

import pytest

from app.models.enums import AttributeMethod
from app.rulesets.loader import load_registry
from app.services import character_rules as rules
from app.services.dice import Tier, classify_dice


@pytest.fixture(scope="module")
def registry():
    return load_registry()


def test_registry_loads_packs_and_catalog(registry):
    assert {"srd-5.1", "srd-5.2", "generico"} <= set(registry.packs)
    catalog_ids = {c.id for c in registry.catalog}
    assert "old-dragon-2" in catalog_ids and "daggerheart" in catalog_ids
    # Tormenta20 foi excluído pela licença (proíbe apps): não pode aparecer em lugar nenhum.
    assert not any("tormenta" in i for i in set(registry.packs) | catalog_ids)


def test_available_packs_have_attribution_when_licensed(registry):
    for pack in registry.packs.values():
        if pack.license.startswith("CC-BY"):
            assert "Creative Commons" in pack.attribution, pack.id


def test_class_preset_uses_priority(registry):
    pack = registry.get("srd-5.1")
    base, audit = rules.generate_base(pack, AttributeMethod.CLASS_PRESET, class_key="wizard")
    assert base == {"int": 15, "con": 14, "dex": 13, "wis": 12, "cha": 10, "str": 8}
    assert audit == []


def test_standard_array_validation(registry):
    pack = registry.get("srd-5.1")
    ok = {"str": 15, "dex": 14, "con": 13, "int": 12, "wis": 10, "cha": 8}
    assert rules.generate_base(pack, AttributeMethod.STANDARD_ARRAY, scores=ok)[0] == ok
    with pytest.raises(rules.RulesError):
        rules.generate_base(pack, AttributeMethod.STANDARD_ARRAY, scores={**ok, "cha": 15})


def test_point_buy_budget(registry):
    pack = registry.get("srd-5.2")
    ok = {"str": 15, "dex": 15, "con": 15, "int": 8, "wis": 8, "cha": 8}  # 27 pontos
    assert rules.point_buy_spent(pack, ok) == 27
    rules.generate_base(pack, AttributeMethod.POINT_BUY, scores=ok)
    with pytest.raises(rules.RulesError):
        rules.generate_base(pack, AttributeMethod.POINT_BUY, scores={**ok, "int": 9})
    with pytest.raises(rules.RulesError):
        rules.generate_base(pack, AttributeMethod.POINT_BUY, scores={**ok, "int": 16})


def test_roll_method_assigns_by_class_and_audits(registry):
    pack = registry.get("srd-5.1")
    base, audit = rules.generate_base(pack, AttributeMethod.ROLL, class_key="fighter", rng=random.Random(5))
    assert len(audit) == 6
    totals = sorted((a["total"] for a in audit), reverse=True)
    assert base["str"] == totals[0] and base["int"] == totals[-1]
    assert all(3 <= v <= 18 for v in base.values())


def test_bonuses_srd51_half_elf_choices(registry):
    pack = registry.get("srd-5.1")
    bonuses = rules.compute_bonuses(pack, ancestry_key="half-elf", ancestry_choices=["str", "con"])
    assert bonuses == {"cha": 2, "str": 1, "con": 1}
    with pytest.raises(rules.RulesError):
        rules.compute_bonuses(pack, ancestry_key="half-elf", ancestry_choices=["cha", "con"])


def test_bonuses_srd52_background(registry):
    pack = registry.get("srd-5.2")
    bonuses = rules.compute_bonuses(
        pack, ancestry_key="human", background_key="soldier", background_bonus={"str": 2, "con": 1}
    )
    assert bonuses == {"str": 2, "con": 1}
    with pytest.raises(rules.RulesError):
        rules.compute_bonuses(
            pack, ancestry_key="human", background_key="soldier", background_bonus={"int": 2, "con": 1}
        )
    with pytest.raises(rules.RulesError):
        rules.compute_bonuses(pack, ancestry_key="human", background_key="soldier", background_bonus={"str": 3})


def test_hp_and_carry(registry):
    pack = registry.get("srd-5.1")
    attrs = {"str": 16, "dex": 12, "con": 15, "int": 8, "wis": 10, "cha": 10}
    assert rules.compute_hp_max(pack, class_key="barbarian", ancestry_key="half-orc", attributes=attrs) == 14
    # Anão da Colina: +1 PV por nível.
    assert rules.compute_hp_max(pack, class_key="fighter", ancestry_key="hill-dwarf", attributes=attrs) == 13
    assert (
        rules.compute_hp_max(pack, class_key="wizard", ancestry_key="human", attributes=attrs, level=3)
        == 6 + 2 + (4 + 2) * 2
    )
    assert rules.carry_capacity(pack, attrs) == (240.0, "lb")
    generic = registry.get("generico")
    assert rules.compute_hp_max(generic, class_key=None, ancestry_key=None, attributes={}) == 10
    assert rules.carry_capacity(generic, {}) == (50.0, "kg")


def test_spell_slots(registry):
    assert rules.initial_spell_slots(registry.get("srd-5.1"), "paladin") == {}
    assert rules.initial_spell_slots(registry.get("srd-5.2"), "paladin") == {"1": {"max": 2, "used": 0}}
    assert rules.initial_spell_slots(registry.get("srd-5.1"), "warlock") == {"1": {"max": 1, "used": 0}}


def test_ruleset_crit_rules_feed_outcome(registry):
    outcome_rules = registry.outcome_rules("srd-5.2")
    assert classify_dice([(20, 20)], outcome_rules).tier is Tier.CRITICAL_SUCCESS
    assert classify_dice([(20, 1)], outcome_rules).tier is Tier.CRITICAL_FAILURE
