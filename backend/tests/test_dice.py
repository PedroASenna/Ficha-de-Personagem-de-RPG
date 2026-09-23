import json
import random
from pathlib import Path

import pytest

from app.services.dice import EFFECTS, NotationError, OutcomeRules, Tier, classify, classify_dice, parse, roll

SHARED = Path(__file__).resolve().parents[2] / "shared"


@pytest.mark.parametrize(
    ("notation", "canonical"),
    [
        ("d20", "1d20"),
        ("1d20+5", "1d20+5"),
        (" 2D20KH1 + 3 ", "2d20kh1+3"),
        ("4d6kh3", "4d6kh3"),
        ("d%", "1d100"),
        ("3d6-2", "3d6-2"),
        ("1d8+1d6+2", "1d8+1d6+2"),
        ("-1d4+10", "-1d4+10"),
        ("2d20kl1", "2d20kl1"),
        ("1d1000", "1d1000"),
        ("d5+d16+d24+d30+d60", "1d5+1d16+1d24+1d30+1d60"),
    ],
)
def test_parse_valid(notation, canonical):
    assert parse(notation).canonical() == canonical


@pytest.mark.parametrize(
    "notation",
    ["", "abc", "d7", "1d3", "0d6", "101d6", "4d6kh5", "1d20++5", "1d20 5", "5", "d20" + "+1" * 40, "1d20+99999"],
)
def test_parse_invalid(notation):
    with pytest.raises(NotationError):
        parse(notation)


def test_roll_respects_bounds_and_keep():
    rng = random.Random(42)
    for _ in range(200):
        result = roll(parse("4d6kh3+2"), rng)
        dice = result.terms[0].dice
        assert len(dice) == 4
        assert sum(d.kept for d in dice) == 3
        assert all(1 <= d.value <= 6 for d in dice)
        dropped = next(d for d in dice if not d.kept)
        assert dropped.value <= min(d.value for d in dice if d.kept)
        assert result.total == sum(d.value for d in dice if d.kept) + 2


def test_roll_keep_lowest_and_negative_terms():
    rng = random.Random(7)
    result = roll(parse("2d20kl1-1d4"), rng)
    d20s, d4s = result.terms
    kept = [d for d in d20s.dice if d.kept]
    assert len(kept) == 1 and kept[0].value == min(d.value for d in d20s.dice)
    assert result.total == kept[0].value - d4s.dice[0].value
    # Dados subtraídos não entram na classificação.
    assert result.kept_positive_dice() == kept


def test_roll_to_dict_shape():
    result = roll(parse("1d20+5"), random.Random(1))
    data = result.to_dict()
    assert data["notation"] == "1d20+5"
    assert data["modifier"] == 5
    assert data["total"] == data["terms"][0]["dice"][0]["value"] + 5


def test_every_supported_die_covers_its_range():
    rng = random.Random(3)
    for sides in (2, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 60, 100):
        seen = {roll(parse(f"1d{sides}"), rng).total for _ in range(sides * 60)}
        assert seen == set(range(1, sides + 1)), sides


def _vectors():
    data = json.loads((SHARED / "dice-outcome-vectors.json").read_text(encoding="utf-8"))
    return [(case, data["rules"][case["rules"]]) for case in data["cases"]]


@pytest.mark.parametrize(
    ("case", "rules"), _vectors(), ids=lambda v: v["name"] if isinstance(v, dict) and "name" in v else ""
)
def test_shared_outcome_vectors(case, rules):
    outcome = classify_dice([tuple(k) for k in case["kept"]], OutcomeRules.from_dict(rules))
    assert outcome.tier.value == case["expected"]["tier"]
    assert outcome.natural == case["expected"]["natural"]
    assert outcome.intensity == pytest.approx(case["expected"]["intensity"], abs=1e-9)


def test_effects_match_shared_file():
    shared = json.loads((SHARED / "dice-effects.json").read_text(encoding="utf-8"))
    assert {k.value if isinstance(k, Tier) else k: v for k, v in EFFECTS.items()} == shared


def test_classify_uses_kept_die_of_advantage():
    class Fixed(random.Random):
        def __init__(self, values):
            super().__init__()
            self._values = iter(values)

        def randint(self, a, b):
            return next(self._values)

    rules = OutcomeRules.from_dict({"crit_rules": [{"sides": 20, "success": [20], "failure": [1]}]})
    outcome = classify(roll(parse("2d20kh1+3"), Fixed([1, 20])), rules)
    assert outcome.tier is Tier.CRITICAL_SUCCESS
    assert outcome.effect["animation"] == "golden_burst"
    outcome = classify(roll(parse("2d20kl1"), Fixed([1, 20])), rules)
    assert outcome.tier is Tier.CRITICAL_FAILURE
    assert outcome.effect["crack"] is True
