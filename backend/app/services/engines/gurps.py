"""Ficha do GURPS 4ª Edição: tudo é comprado com pontos de personagem.

``character.build`` guarda o que o jogador comprou:

    {"points": 150, "earned": 0,
     "attributes": {"st": 10, "dx": 12, "iq": 10, "ht": 11},
     "secondary": {"hp": 0, "will": 0, "per": 0, "fp": 0, "speed": 0, "move": 0},   # níveis comprados (speed em 0,25)
     "traits": [{"key": "ambidestria", "level": 1, "note": ""}, {"key": "furia", "self_control": 9}],
     "skills": [{"key": "espadas-curtas", "points": 4, "note": ""}],
     "fp_current": 11}

Custos (Módulo Básico: Personagens, págs. 14-17 e 170): ST e HT 10/nível, DX e IQ 20/nível; PV 2, Vontade 5,
Percepção 5, PF 3, Velocidade Básica 5 por 0,25, Deslocamento 5. Perícias: 1 ponto dá atributo+0 (Fácil) a
atributo-3 (Muito Difícil), 2 pontos +1, 4 pontos +2 e +1 a cada 4 pontos depois.
"""

import math
from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.rulesets.schema import RulesetPack, TraitDef
from app.services.character_rules import RulesError

ATTRIBUTE_COST = {"st": 10, "dx": 20, "iq": 20, "ht": 10}
SECONDARY_COST = {"hp": 2, "will": 5, "per": 5, "fp": 3, "speed": 5, "move": 5}
SECONDARY_LABEL = {
    "hp": "Pontos de Vida",
    "will": "Vontade",
    "per": "Percepção",
    "fp": "Pontos de Fadiga",
    "speed": "Velocidade Básica",
    "move": "Deslocamento Básico",
}
DIFFICULTY_OFFSET = {"F": 0, "M": -1, "D": -2, "MD": -3}
DIFFICULTY_LABEL = {"F": "Fácil", "M": "Média", "D": "Difícil", "MD": "Muito Difícil"}
SELF_CONTROL = {6: 2.0, 9: 1.5, 12: 1.0, 15: 0.5}
ATTRIBUTE_RANGE = (1, 30)


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TraitIn(_In):
    key: str = Field(max_length=64)
    level: int = Field(default=1, ge=1, le=100)
    # Custo por nível escolhido quando a lista dá opções (ex.: Hierarquia 5 ou 10/nível).
    per: int | None = Field(default=None, ge=-500, le=500)
    # Custo digitado quando a lista diz "Variável", "5 a 15" ou "0 ou 5".
    base_cost: int | None = Field(default=None, ge=-500, le=500)
    self_control: int | None = None
    note: str = Field(default="", max_length=80)


class SkillIn(_In):
    key: str = Field(max_length=64)
    points: int = Field(ge=1, le=400)
    note: str = Field(default="", max_length=60)


class SecondaryIn(_In):
    hp: int = Field(default=0, ge=-30, le=100)
    will: int = Field(default=0, ge=-20, le=40)
    per: int = Field(default=0, ge=-20, le=40)
    fp: int = Field(default=0, ge=-30, le=100)
    speed: int = Field(default=0, ge=-40, le=80)
    move: int = Field(default=0, ge=-10, le=40)


class BuildIn(_In):
    points: int = Field(default=150, ge=0, le=5000)
    earned: int = Field(default=0, ge=0, le=100000)
    attributes: dict[str, int] = Field(default_factory=dict)
    secondary: SecondaryIn = Field(default_factory=SecondaryIn)
    traits: list[TraitIn] = Field(default_factory=list, max_length=200)
    skills: list[SkillIn] = Field(default_factory=list, max_length=300)
    fp_current: int | None = Field(default=None, ge=-100, le=1000)


def default_build(pack: RulesetPack) -> dict[str, Any]:
    rules = pack.gurps
    return {
        "points": rules.starting_points if rules else 150,
        "earned": 0,
        "attributes": dict.fromkeys(ATTRIBUTE_COST, 10),
        "secondary": SecondaryIn().model_dump(),
        "traits": [],
        "skills": [],
        "fp_current": None,
    }


def skill_step(points: int) -> int:
    """Quanto os pontos somam ao NH relativo: 1 → +0, 2 → +1, 4 → +2, 8 → +3, 12 → +4..."""
    if points == 1:
        return 0
    if points == 2:
        return 1
    if points >= 4 and points % 4 == 0:
        return 2 + (points - 4) // 4
    raise RulesError("Perícias custam 1, 2, 4 pontos e depois múltiplos de 4 (8, 12, 16...).")


def trait_cost(defn: TraitDef, entry: TraitIn) -> int:
    cost = defn.cost
    if cost is None:
        raise RulesError(f"{defn.name} não tem custo em pontos.")
    negative = defn.kind in ("disadvantage", "quirk")
    if cost.fixed is not None:
        base = cost.fixed
    elif cost.per_level:
        per = entry.per if entry.per is not None else cost.per_level[0]
        if per not in cost.per_level:
            raise RulesError(f"{defn.name}: custo por nível deve ser {', '.join(map(str, cost.per_level))}.")
        base = cost.base + per * entry.level
    else:
        if entry.base_cost is None:
            raise RulesError(f"Informe o custo de {defn.name} (veja a pág. {defn.page}).")
        base = entry.base_cost
        if cost.options and base not in cost.options:
            raise RulesError(f"{defn.name}: o custo deve ser {', '.join(map(str, cost.options))}.")
        if cost.min is not None and base < cost.min or cost.max is not None and base > cost.max:
            raise RulesError(f"{defn.name}: custo fora da faixa do livro.")
        if cost.variable and (base > 0 if negative else base < 0):
            raise RulesError(f"{defn.name}: o custo precisa ser {'negativo' if negative else 'positivo'}.")
    if cost.self_control:
        number = entry.self_control or 12
        if number not in SELF_CONTROL:
            raise RulesError("Número de autocontrole: 6, 9, 12 ou 15.")
        # "Ignore todas as frações" (pág. 121): trunca em direção ao zero.
        return int(base * SELF_CONTROL[number])
    if entry.self_control is not None:
        raise RulesError(f"{defn.name} não tem número de autocontrole.")
    return base


def _parse(pack: RulesetPack, data: Mapping[str, Any]) -> BuildIn:
    try:
        build = BuildIn.model_validate({**default_build(pack), **data})
    except ValidationError as exc:
        raise RulesError(f"Ficha inválida: {exc.errors()[0]['msg']}") from exc
    if set(build.attributes) != set(ATTRIBUTE_COST):
        raise RulesError("Informe ST, DX, IQ e HT.")
    low, high = ATTRIBUTE_RANGE
    if any(not low <= v <= high for v in build.attributes.values()):
        raise RulesError(f"Atributos vão de {low} a {high}.")
    for entry in build.traits:
        defn = pack.trait(entry.key)
        if defn is None:
            raise RulesError("Vantagem ou desvantagem desconhecida.")
        trait_cost(defn, entry)
        if defn.name.endswith("(descreva)") and not entry.note.strip():
            raise RulesError(f"Descreva a {defn.name.removesuffix(' (descreva)').lower()}.")
    seen: set[tuple[str, str]] = set()
    for skill in build.skills:
        defn = pack.skill(skill.key)
        if defn is None:
            raise RulesError("Perícia desconhecida.")
        skill_step(skill.points)
        if defn.specialize and not skill.note.strip():
            raise RulesError(f"{defn.name} exige especialização (ex.: {defn.name} (Espadas)).")
        ident = (skill.key, skill.note.strip().lower())
        if ident in seen:
            raise RulesError(f"{defn.name} está repetida.")
        seen.add(ident)
    return build


def known(pack: RulesetPack, data: Mapping[str, Any]) -> dict[str, Any]:
    """Ficha salva com itens que o pacote não tem mais (lista corrigida numa versão nova): ignora em vez de quebrar."""

    def valid_trait(raw: Mapping[str, Any]) -> bool:
        defn = pack.trait(str(raw.get("key", "")))
        if defn is None:
            return False
        try:
            trait_cost(defn, TraitIn.model_validate(raw))
        except (RulesError, ValidationError):
            return False
        return True

    traits = [raw for raw in data.get("traits") or [] if valid_trait(raw)]
    skills = [s for s in data.get("skills") or [] if pack.skill(str(s.get("key", "")))]
    return {**data, "traits": traits, "skills": skills}


def unspent(pack: RulesetPack, data: Mapping[str, Any]) -> int:
    return _points(pack, _parse(pack, known(pack, data)))["unspent"]


def normalize(pack: RulesetPack, current: Mapping[str, Any] | None, patch: Mapping[str, Any]) -> dict[str, Any]:
    """Junta a alteração com o que já está salvo e valida. Devolve o JSON a guardar."""
    merged = {**default_build(pack), **(current or {}), **patch}
    return _parse(pack, merged).model_dump()


def _magery(pack: RulesetPack, build: BuildIn) -> int:
    bonus = 0
    for entry in build.traits:
        defn = pack.trait(entry.key)
        if defn and defn.effects.spell_bonus_per_level:
            bonus += defn.effects.spell_bonus_per_level * entry.level
    return bonus


def _base_values(build: BuildIn) -> dict[str, int]:
    a, s = build.attributes, build.secondary
    return {**a, "will": a["iq"] + s.will, "per": a["iq"] + s.per}


def basic_lift(st: int) -> float:
    """Base de Carga em kg (ST²/10): inteiro a partir de 5 kg, como na tabela da pág. 17."""
    value = st * st / 10
    return float(math.floor(value + 0.5)) if value >= 5 else round(value, 1)


def damage(pack: RulesetPack, st: int) -> tuple[str, str]:
    table = pack.gurps.damage if pack.gurps else []
    row = None
    for entry in table:
        if entry[0] <= st:
            row = entry
    return (row[1], row[2]) if row else ("-", "-")


def derived(pack: RulesetPack, build: BuildIn) -> dict[str, Any]:
    a, s = build.attributes, build.secondary
    speed = (a["ht"] + a["dx"]) / 4 + s.speed * 0.25
    thrust, swing = damage(pack, a["st"])
    return {
        "hp": a["st"] + s.hp,
        "will": a["iq"] + s.will,
        "per": a["iq"] + s.per,
        "fp": a["ht"] + s.fp,
        "speed": speed,
        "move": math.floor(speed) + s.move,
        "dodge": math.floor(speed) + 3,
        "basic_lift": basic_lift(a["st"]),
        "thrust": thrust,
        "swing": swing,
    }


def skill_level(pack: RulesetPack, build: BuildIn, key: str, points: int) -> int:
    defn = pack.skill(key)
    base = _base_values(build)[defn.attribute]
    level = base + DIFFICULTY_OFFSET[defn.difficulty or "M"] + skill_step(points)
    if defn.category == "Mágica":
        level += _magery(pack, build)
    return level


def _points(pack: RulesetPack, build: BuildIn) -> dict[str, Any]:
    attributes = {k: (v - 10) * ATTRIBUTE_COST[k] for k, v in build.attributes.items()}
    secondary = {k: v * SECONDARY_COST[k] for k, v in build.secondary.model_dump().items()}
    by_kind = {"advantage": 0, "perk": 0, "disadvantage": 0, "quirk": 0}
    quirks = 0
    for entry in build.traits:
        defn = pack.trait(entry.key)
        by_kind[defn.kind] += trait_cost(defn, entry)
        quirks += defn.kind == "quirk"
    skills = sum(s.points for s in build.skills)
    spent = sum(attributes.values()) + sum(secondary.values()) + sum(by_kind.values()) + skills
    total = build.points + build.earned
    # Limite de desvantagens: tudo com custo negativo, menos peculiaridades (pág. 11).
    negative = (
        sum(v for v in attributes.values() if v < 0)
        + sum(v for v in secondary.values() if v < 0)
        + by_kind["disadvantage"]
    )
    rules = pack.gurps
    limit = -(build.points * (rules.disadvantage_limit_percent if rules else 50) // 100)
    return {
        "total": total,
        "starting": build.points,
        "earned": build.earned,
        "spent": spent,
        "unspent": total - spent,
        "breakdown": {
            "attributes": sum(attributes.values()),
            "secondary": sum(secondary.values()),
            "advantages": by_kind["advantage"] + by_kind["perk"],
            "disadvantages": by_kind["disadvantage"],
            "quirks": by_kind["quirk"],
            "skills": skills,
        },
        "disadvantages": negative,
        "disadvantage_limit": limit,
        "quirks": quirks,
        "quirk_limit": rules.quirk_limit if rules else 5,
    }


def _warnings(build: BuildIn, points: dict[str, Any]) -> list[str]:
    a, s = build.attributes, build.secondary
    out = []
    if points["unspent"] < 0:
        out.append(f"Gastou {-points['unspent']} pontos a mais do que tem.")
    if points["disadvantages"] < points["disadvantage_limit"]:
        out.append(f"Desvantagens somam {points['disadvantages']}; o limite é {points['disadvantage_limit']}.")
    if points["quirks"] > points["quirk_limit"]:
        out.append(f"No máximo {points['quirk_limit']} peculiaridades.")
    if abs(s.hp) > math.floor(a["st"] * 0.3):
        out.append("PV variando mais de 30% da ST: só com permissão do Mestre (pág. 16).")
    if abs(s.speed) > 8:
        out.append("Velocidade Básica alterada em mais de 2,00: só com permissão do Mestre (pág. 17).")
    if abs(s.move) > 3:
        out.append("Deslocamento alterado em mais de 3: só com permissão do Mestre (pág. 17).")
    if a["iq"] + s.will > 20 or a["iq"] + s.per > 20:
        out.append("Vontade e Percepção normalmente vão até 20.")
    return out


def sheet(pack: RulesetPack, data: Mapping[str, Any]) -> dict[str, Any]:
    build = _parse(pack, known(pack, data))
    points = _points(pack, build)
    d = derived(pack, build)
    traits = []
    for entry in build.traits:
        defn = pack.trait(entry.key)
        name = defn.name.removesuffix(" (descreva)")
        if defn.cost and defn.cost.per_level:
            name += f" ×{entry.level}" if defn.cost.unit else f" {entry.level}"
        if defn.cost and defn.cost.self_control:
            name += f" ({entry.self_control or 12})"
        traits.append(
            {
                "key": entry.key,
                "name": name,
                "note": entry.note,
                "kind": defn.kind,
                "cost": trait_cost(defn, entry),
                "page": defn.page,
            }
        )
    skills = []
    for entry in build.skills:
        defn = pack.skill(entry.key)
        level = skill_level(pack, build, entry.key, entry.points)
        attr_abbr = {"st": "ST", "dx": "DX", "iq": "IQ", "ht": "HT", "will": "Von", "per": "Per"}[defn.attribute]
        relative = level - _base_values(build)[defn.attribute]
        skills.append(
            {
                "key": entry.key,
                "name": defn.name + (f" ({entry.note})" if entry.note else ""),
                "points": entry.points,
                "level": level,
                "relative": f"{attr_abbr}{relative:+d}" if relative else attr_abbr,
                "difficulty": f"{attr_abbr}/{defn.difficulty}",
                "category": defn.category,
                "page": defn.page,
            }
        )
    fp_max = d["fp"]
    return {
        "engine": "gurps",
        "points": points,
        "derived": [
            {"key": "hp", "label": "PV", "value": d["hp"]},
            {
                "key": "fp",
                "label": "PF",
                "value": fp_max,
                "current": fp_max if build.fp_current is None else build.fp_current,
            },
            {"key": "will", "label": "Vontade", "value": d["will"]},
            {"key": "per", "label": "Percepção", "value": d["per"]},
            {"key": "speed", "label": "Velocidade Básica", "value": f"{d['speed']:.2f}".replace(".", ",")},
            {"key": "move", "label": "Deslocamento", "value": d["move"]},
            {"key": "dodge", "label": "Esquiva", "value": d["dodge"]},
            {"key": "basic_lift", "label": "Base de Carga", "value": f"{d['basic_lift']:g} kg".replace(".", ",")},
            {"key": "damage", "label": "Dano", "value": f"GdP {d['thrust']} · GeB {d['swing']}"},
        ],
        "traits": traits,
        "skills": skills,
        "checks": checks(pack, build, d, skills),
        "warnings": _warnings(build, points),
    }


def checks(pack: RulesetPack, build: BuildIn, d: dict[str, Any], skills: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Testes prontos para o app: 3d6 contra o valor (quem rola não precisa saber as regras)."""
    a = build.attributes
    out = [
        {"key": k, "label": label, "notation": "3d6", "target": value, "group": group}
        for k, label, value, group in (
            ("st", "ST", a["st"], "Atributos"),
            ("dx", "DX", a["dx"], "Atributos"),
            ("iq", "IQ", a["iq"], "Atributos"),
            ("ht", "HT", a["ht"], "Atributos"),
            ("will", "Vontade", d["will"], "Secundárias"),
            ("per", "Percepção", d["per"], "Secundárias"),
        )
    ]
    out.append({"key": "dodge", "label": "Esquiva", "notation": "3d6", "target": d["dodge"], "group": "Defesa"})
    for s in skills:
        group = "Mágicas" if s["category"] == "Mágica" else "Perícias"
        out.append({"key": s["key"], "label": s["name"], "notation": "3d6", "target": s["level"], "group": group})
    return out


def hp_max(data: Mapping[str, Any]) -> int:
    attributes = data.get("attributes") or {}
    return max(1, int(attributes.get("st", 10)) + int((data.get("secondary") or {}).get("hp", 0)))


def missing(pack: RulesetPack, data: Mapping[str, Any]) -> list[str]:
    points = _points(pack, _parse(pack, known(pack, data)))
    out = []
    if points["unspent"] < 0:
        out.append("points")
    if points["disadvantages"] < points["disadvantage_limit"]:
        out.append("disadvantages")
    if points["quirks"] > points["quirk_limit"]:
        out.append("quirks")
    return out


def level_label(data: Mapping[str, Any]) -> str:
    total = int(data.get("points", 150)) + int(data.get("earned", 0))
    return f"{total} pontos"


def gain(data: Mapping[str, Any], amount: int) -> dict[str, Any]:
    return {**data, "earned": int(data.get("earned", 0)) + amount}
