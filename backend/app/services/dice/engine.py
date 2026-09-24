"""Rolagem autoritativa no servidor.

Usamos ``secrets.SystemRandom`` (CSPRNG do sistema operacional): em mesa multiplayer ninguém
consegue prever ou forjar o resultado pelo cliente. Os testes injetam um ``random.Random`` com seed.
"""

import random
import secrets
from dataclasses import dataclass

from app.services.dice.notation import DiceExpression, DiceTerm

_system_rng = secrets.SystemRandom()
# Um dado que explode pode continuar rolando; o limite só evita laço infinito com um RNG viciado.
MAX_EXPLOSIONS = 20


@dataclass(frozen=True)
class DieResult:
    sides: int
    value: int
    kept: bool
    # Dados que explodem: cada rolagem (a soma é o value). Um só elemento = não explodiu.
    rolls: tuple[int, ...] = ()

    @property
    def first(self) -> int:
        """Resultado natural do primeiro lançamento (olhos de cobra, críticos)."""
        return self.rolls[0] if self.rolls else self.value

    def to_dict(self) -> dict:
        out = {"sides": self.sides, "value": self.value, "kept": self.kept}
        if len(self.rolls) > 1:
            out["rolls"] = list(self.rolls)
        return out


@dataclass(frozen=True)
class TermResult:
    term: DiceTerm
    dice: tuple[DieResult, ...]

    @property
    def subtotal(self) -> int:
        return self.term.sign * sum(d.value for d in self.dice if d.kept)


@dataclass(frozen=True)
class RollResult:
    expression: DiceExpression
    terms: tuple[TermResult, ...]

    @property
    def total(self) -> int:
        return sum(t.subtotal for t in self.terms) + self.expression.modifier

    def kept_positive_dice(self) -> list[DieResult]:
        """Dados que contam a favor (base da classificação de sucesso/falha)."""
        return [d for t in self.terms if t.term.sign > 0 for d in t.dice if d.kept]

    def to_dict(self) -> dict:
        return {
            "notation": self.expression.canonical(),
            "terms": [
                {
                    "notation": t.term.canonical(),
                    "sign": t.term.sign,
                    "dice": [d.to_dict() for d in t.dice],
                    "subtotal": t.subtotal,
                }
                for t in self.terms
            ],
            "modifier": self.expression.modifier,
            "total": self.total,
        }


def _keep_flags(values: list[int], term: DiceTerm) -> list[bool]:
    if term.keep is None:
        return [True] * len(values)
    # Empate: mantém o dado que saiu primeiro (ordem estável).
    order = sorted(range(len(values)), key=lambda i: (-values[i] if term.keep == "kh" else values[i], i))
    keep = set(order[: term.kept_count])
    return [i in keep for i in range(len(values))]


def roll_die(sides: int, explode: bool, rng: random.Random) -> tuple[int, ...]:
    rolls = [rng.randint(1, sides)]
    while explode and rolls[-1] == sides and len(rolls) <= MAX_EXPLOSIONS:
        rolls.append(rng.randint(1, sides))
    return tuple(rolls)


def roll(expression: DiceExpression, rng: random.Random | None = None) -> RollResult:
    rng = rng or _system_rng
    term_results = []
    for term in expression.terms:
        rolled = [roll_die(term.sides, term.explode, rng) for _ in range(term.count)]
        values = [sum(r) for r in rolled]
        flags = _keep_flags(values, term)
        dice = tuple(
            DieResult(sides=term.sides, value=v, kept=k, rolls=r if term.explode else ())
            for v, k, r in zip(values, flags, rolled, strict=True)
        )
        term_results.append(TermResult(term=term, dice=dice))
    return RollResult(expression=expression, terms=tuple(term_results))
