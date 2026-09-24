"""Testes contra um alvo, com as regras de cada motor.

- GURPS: 3d6 contra o nível de habilidade (NH). Sucesso com resultado <= NH. Sucesso decisivo em 3-4
  (5 com NH 15+, 6 com NH 16+); falha crítica em 18, em 17 com NH até 15 e em 10+ acima do NH.
  17 e 18 sempre falham, 3 e 4 sempre dão certo.
- Savage Worlds: o dado da característica (que explode) e, para Cartas Selvagens, o Dado Selvagem d6 (que
  também explode). Vale o maior, somado ao modificador. Sucesso com total >= dificuldade (padrão 4) e uma
  ampliação a cada 4 acima. Os dois dados no 1 ("olhos de cobra") é falha crítica.
- Clássico (d20): sucesso com total >= alvo; 20 natural é crítico e 1 natural é falha crítica (se o
  sistema define).

O resultado vira uma faixa de animação (Tier) igual às rolagens comuns: o app não precisa conhecer as regras.
"""

import random
from dataclasses import dataclass
from typing import Any, Literal

from app.services.dice.engine import RollResult, _system_rng, roll
from app.services.dice.notation import DiceExpression, DiceTerm, parse
from app.services.dice.outcome import EFFECTS, Outcome, OutcomeRules, Tier, classify

Engine = Literal["classic", "gurps", "savage"]
SAVAGE_TARGET = 4
WILD_DIE = DiceTerm(count=1, sides=6, explode=True)


@dataclass(frozen=True)
class CheckResult:
    roll: dict[str, Any]
    outcome: Outcome
    check: dict[str, Any]
    total: int


def _outcome(tier: Tier, natural: int | None, intensity: float) -> Outcome:
    return Outcome(tier=tier, natural=natural, intensity=intensity, effect=dict(EFFECTS[tier]))


def gurps_verdict(total: int, target: int) -> tuple[bool, bool]:
    """(sucesso, crítico) de um teste de 3d6 contra o NH."""
    if total <= 4 or (total == 5 and target >= 15) or (total == 6 and target >= 16):
        return True, True
    if total == 18 or (total == 17 and target <= 15) or total >= target + 10:
        return False, True
    if total == 17:
        return False, False
    return total <= target, False


def _gurps(result: RollResult, target: int) -> CheckResult:
    total = result.total
    # Críticos só valem no teste padrão de 3d6 sem modificador na rolagem (o modificador vai no NH).
    plain = len(result.terms) == 1 and result.terms[0].term.count == 3 and result.terms[0].term.sides == 6
    success, critical = gurps_verdict(total, target) if plain else (total <= target, False)
    margin = target - total
    if critical:
        tier = Tier.CRITICAL_SUCCESS if success else Tier.CRITICAL_FAILURE
    else:
        tier = Tier.HIGH if success else Tier.LOW
    intensity = 1.0 if critical else min(1.0, round(abs(margin) / 10, 3))
    check = {"kind": "gurps", "target": target, "success": success, "critical": critical, "margin": margin}
    return CheckResult(result.to_dict(), _outcome(tier, None, intensity), check, total)


def _savage(expression: DiceExpression, target: int, wild: bool, rng: random.Random) -> CheckResult:
    trait = roll(expression, rng)
    trait_dice = trait.kept_positive_dice()
    data = trait.to_dict()
    best = trait.total
    wild_first = None
    if wild:
        wild_roll = roll(DiceExpression(terms=(WILD_DIE,), modifier=0), rng)
        die = wild_roll.terms[0].dice[0]
        wild_total = die.value + expression.modifier
        wild_first = die.first
        wild_wins = wild_total > best
        best = max(best, wild_total)
        # O dado que perdeu aparece esmaecido (kept=false), como no "fica com o maior".
        if wild_wins:
            for term in data["terms"]:
                for d in term["dice"]:
                    d["kept"] = False
        data["terms"].append(
            {
                "notation": "1d6!",
                "sign": 1,
                "wild": True,
                "dice": [{**die.to_dict(), "kept": wild_wins}],
                "subtotal": die.value,
            }
        )
        data["total"] = best
    snake_eyes = wild and bool(trait_dice) and trait_dice[0].first == 1 and wild_first == 1
    success = best >= target and not snake_eyes
    raises = (best - target) // 4 if success else 0
    if snake_eyes:
        tier = Tier.CRITICAL_FAILURE
    elif raises >= 1:
        tier = Tier.CRITICAL_SUCCESS
    elif success:
        tier = Tier.HIGH
    else:
        tier = Tier.LOW
    intensity = 1.0 if snake_eyes or raises >= 2 else 0.6 if raises == 1 else 0.3
    check = {
        "kind": "savage",
        "target": target,
        "success": success,
        "raises": raises,
        "critical": snake_eyes,
        "wild": wild,
    }
    return CheckResult(data, _outcome(tier, None, intensity), check, best)


def _classic(result: RollResult, target: int, rules: OutcomeRules) -> CheckResult:
    base = classify(result, rules)
    total = result.total
    if base.tier in (Tier.CRITICAL_SUCCESS, Tier.CRITICAL_FAILURE) and base.natural is not None:
        success = base.tier == Tier.CRITICAL_SUCCESS
        critical = True
    else:
        success = total <= target if rules.direction == "low" else total >= target
        critical = False
    tier = base.tier if critical else (Tier.HIGH if success else Tier.LOW)
    check = {"kind": "classic", "target": target, "success": success, "critical": critical, "margin": total - target}
    return CheckResult(result.to_dict(), _outcome(tier, base.natural, base.intensity), check, total)


def run_check(
    engine: Engine,
    expression: DiceExpression,
    *,
    target: int | None,
    wild: bool = False,
    rules: OutcomeRules = OutcomeRules(),
    rng: random.Random | None = None,
) -> CheckResult:
    rng = rng or _system_rng
    if engine == "savage":
        return _savage(expression, SAVAGE_TARGET if target is None else target, wild, rng)
    result = roll(expression, rng)
    if target is None:
        raise ValueError("Teste sem alvo.")
    if engine == "gurps":
        return _gurps(result, target)
    return _classic(result, target, rules)


def check_suffix(check: dict[str, Any]) -> str:
    """Complemento do texto do log: "— sucesso por 3", "— 2 ampliações", "— FALHA CRÍTICA!"."""
    if check["kind"] == "savage":
        if check["critical"]:
            return " — FALHA CRÍTICA (olhos de cobra)!"
        if not check["success"]:
            return " — falha"
        raises = check["raises"]
        return " — sucesso" if raises == 0 else f" — sucesso com {raises} ampliaç{'ão' if raises == 1 else 'ões'}!"
    target = f" contra {check['target']}"
    if check["critical"]:
        label = "SUCESSO DECISIVO" if check["kind"] == "gurps" else "CRÍTICO"
        return f"{target} — {label}!" if check["success"] else f"{target} — FALHA CRÍTICA!"
    margin = abs(check["margin"])
    return f"{target} — {'sucesso' if check['success'] else 'falha'} por {margin}"


def roll_request(
    engine: Engine,
    notation: str,
    *,
    target: int | None,
    wild: bool,
    rules: OutcomeRules,
) -> tuple[dict[str, Any], Outcome, dict[str, Any] | None, int, str]:
    """Rolagem comum ou teste, conforme o pedido. Devolve (rolagem, faixa, teste, total, notação exibida).

    Sem alvo e sem Dado Selvagem é uma rolagem comum (dano, por exemplo). O Dado Selvagem só existe no
    Savage Worlds; nos outros sistemas é ignorado.
    """
    expression = parse(notation)
    if engine != "savage":
        wild = False
    if target is None and not wild:
        result = roll(expression)
        return result.to_dict(), classify(result, rules), None, result.total, expression.canonical()
    checked = run_check(engine, expression, target=target, wild=wild, rules=rules)
    shown = expression.canonical() + (" + selvagem 1d6!" if wild else "")
    return checked.roll, checked.outcome, checked.check, checked.total, shown
