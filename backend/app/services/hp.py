"""Dano, cura e PV temporário: mesma regra para personagens de jogadores e inimigos do Mestre."""

from typing import Any, Protocol

from app.core.errors import ConflictError


class HasHp(Protocol):
    hp_max: int
    hp_current: int
    hp_temp: int
    version: int


def apply_hp(target: HasHp, delta: int, kind: str, expected_version: int | None) -> dict[str, Any]:
    if expected_version is not None and expected_version != target.version:
        raise ConflictError("A ficha mudou em outro aparelho. Recarregue e tente de novo.")
    before = target.hp_current
    absorbed = 0
    if kind == "damage":
        absorbed = min(target.hp_temp, delta)
        target.hp_temp -= absorbed
        target.hp_current = max(0, target.hp_current - (delta - absorbed))
        effect = "bleed" if target.hp_current < before else "shield_hit"
    elif kind == "heal":
        target.hp_current = min(target.hp_max, target.hp_current + delta)
        effect = "heal_glow"
    else:
        # PV temporário não acumula: fica o maior valor.
        target.hp_temp = max(target.hp_temp, delta)
        effect = "shield_up"
    target.version += 1
    return {
        "kind": kind,
        "delta": delta,
        "hp_before": before,
        "hp_current": target.hp_current,
        "hp_max": target.hp_max,
        "hp_temp": target.hp_temp,
        "absorbed_by_temp": absorbed,
        "effect": effect,
        "version": target.version,
    }


def condition(hp_current: int, hp_max: int) -> str:
    """Estado vago mostrado aos jogadores no lugar dos PV exatos de um inimigo."""
    if hp_current <= 0:
        return "caido"
    if hp_max <= 0 or hp_current >= hp_max:
        return "ileso"
    return "ferido" if hp_current / hp_max > 0.5 else "muito_ferido"


CONDITION_LABEL = {"ileso": "Ileso", "ferido": "Ferido", "muito_ferido": "Muito ferido", "caido": "Caído"}
