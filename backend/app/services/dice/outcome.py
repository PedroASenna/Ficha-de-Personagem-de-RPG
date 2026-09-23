"""Classificação emocional da rolagem: define qual animação o app toca.

A mesma lógica existe em TypeScript (mobile/src/lib/dice/outcome.ts) para o modo offline.
Os dois lados são testados contra shared/dice-outcome-vectors.json, então precisam mudar juntos.

Regras:
1. Se o sistema de regras define críticos para o dado (ex.: d20 natural 20/1), eles valem.
2. Senão, crítico genérico: todos os dados mantidos no máximo (sucesso) ou no mínimo (falha),
   desde que a chance disso seja no máximo 1/6 (produto dos lados >= 6). Em sistemas "roll-under"
   (direction="low") os papéis se invertem.
3. Fora dos críticos, a posição relativa do resultado define a faixa: <= 20% low, >= 80% high.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal

from app.services.dice.engine import RollResult

LOW_THRESHOLD = 0.2
HIGH_THRESHOLD = 0.8
GENERIC_CRIT_MIN_OUTCOMES = 6


class Tier(StrEnum):
    CRITICAL_FAILURE = "critical_failure"
    LOW = "low"
    NEUTRAL = "neutral"
    HIGH = "high"
    CRITICAL_SUCCESS = "critical_success"


@dataclass(frozen=True)
class CritRule:
    sides: int
    success: frozenset[int]
    failure: frozenset[int]


@dataclass(frozen=True)
class OutcomeRules:
    crit_rules: tuple[CritRule, ...] = ()
    direction: Literal["high", "low"] = "high"
    generic_crits: bool = True

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "OutcomeRules":
        if not data:
            return cls()
        return cls(
            crit_rules=tuple(
                CritRule(
                    sides=r["sides"], success=frozenset(r.get("success", [])), failure=frozenset(r.get("failure", []))
                )
                for r in data.get("crit_rules", [])
            ),
            direction=data.get("direction", "high"),
            generic_crits=data.get("generic_crits", True),
        )


@dataclass(frozen=True)
class Outcome:
    tier: Tier
    natural: int | None
    intensity: float
    effect: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"tier": self.tier.value, "natural": self.natural, "intensity": self.intensity, "effect": self.effect}


# Presets de efeito por faixa. O servidor manda só chaves; sons, cores e partículas são assets locais do app.
# Espelho de shared/dice-effects.json (teste garante que são iguais).
EFFECTS: dict[str, dict[str, Any]] = {
    Tier.CRITICAL_FAILURE: {
        "animation": "die_crack",
        "palette": "blood",
        "sound": "impact_dry",
        "haptic": "error_heavy",
        "shake": {"px": 8, "ms": 420},
        "particles": "embers_dark",
        "crack": True,
        "light_burst": False,
    },
    Tier.LOW: {
        "animation": "dim_pulse",
        "palette": "ember",
        "sound": "thud_soft",
        "haptic": "impact_medium",
        "shake": {"px": 3, "ms": 200},
        "particles": None,
        "crack": False,
        "light_burst": False,
    },
    Tier.NEUTRAL: {
        "animation": "settle",
        "palette": "stone",
        "sound": "clack",
        "haptic": "impact_light",
        "shake": {"px": 0, "ms": 0},
        "particles": None,
        "crack": False,
        "light_burst": False,
    },
    Tier.HIGH: {
        "animation": "glow_soft",
        "palette": "gold_soft",
        "sound": "chime",
        "haptic": "success_light",
        "shake": {"px": 0, "ms": 0},
        "particles": "sparkles",
        "crack": False,
        "light_burst": False,
    },
    Tier.CRITICAL_SUCCESS: {
        "animation": "golden_burst",
        "palette": "gold",
        "sound": "epic_fanfare",
        "haptic": "success_heavy",
        "shake": {"px": 2, "ms": 250},
        "particles": "confetti",
        "crack": False,
        "light_burst": True,
    },
}


def classify_dice(kept: Sequence[tuple[int, int]], rules: OutcomeRules = OutcomeRules()) -> Outcome:
    """Classifica a partir dos dados mantidos, como pares (lados, valor)."""
    if not kept:
        return _outcome(Tier.NEUTRAL, None, 0.0)

    natural = kept[0][1] if len(kept) == 1 else None
    rule_sides = {r.sides for r in rules.crit_rules}

    if natural is not None:
        sides = kept[0][0]
        for rule in rules.crit_rules:
            if rule.sides == sides:
                if natural in rule.success:
                    return _outcome(Tier.CRITICAL_SUCCESS, natural, 1.0)
                if natural in rule.failure:
                    return _outcome(Tier.CRITICAL_FAILURE, natural, 1.0)

    low_is_good = rules.direction == "low"
    covered_by_rule = natural is not None and kept[0][0] in rule_sides
    if rules.generic_crits and not covered_by_rule and math.prod(s for s, _ in kept) >= GENERIC_CRIT_MIN_OUTCOMES:
        all_max = all(v == s for s, v in kept)
        all_min = all(v == 1 for _, v in kept)
        if all_max:
            return _outcome(Tier.CRITICAL_FAILURE if low_is_good else Tier.CRITICAL_SUCCESS, natural, 1.0)
        if all_min:
            return _outcome(Tier.CRITICAL_SUCCESS if low_is_good else Tier.CRITICAL_FAILURE, natural, 1.0)

    minimum = len(kept)
    maximum = sum(s for s, _ in kept)
    total = sum(v for _, v in kept)
    ratio = 0.5 if maximum == minimum else (total - minimum) / (maximum - minimum)
    if low_is_good:
        ratio = 1 - ratio

    if ratio <= LOW_THRESHOLD:
        tier = Tier.LOW
    elif ratio >= HIGH_THRESHOLD:
        tier = Tier.HIGH
    else:
        tier = Tier.NEUTRAL
    return _outcome(tier, natural, _round3(abs(ratio - 0.5) * 2))


def classify(result: RollResult, rules: OutcomeRules = OutcomeRules()) -> Outcome:
    return classify_dice([(d.sides, d.value) for d in result.kept_positive_dice()], rules)


def _round3(value: float) -> float:
    # Igual ao Math.round do JS (round() do Python arredonda empates para o par).
    return math.floor(value * 1000 + 0.5) / 1000


def _outcome(tier: Tier, natural: int | None, intensity: float) -> Outcome:
    return Outcome(tier=tier, natural=natural, intensity=intensity, effect=dict(EFFECTS[tier]))
