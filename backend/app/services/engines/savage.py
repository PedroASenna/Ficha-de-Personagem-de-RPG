"""Ficha do Savage Worlds (Edição Brasileira): atributos e perícias em tipos de dado.

``character.build``:

    {"attributes": {"agi": 8, "ast": 6, "esp": 6, "for": 6, "vig": 6},     # lados do dado (4 a 12)
     "skills": [{"key": "lutar", "die": 8, "note": ""}],
     "traits": [{"key": "feio", "severity": "minor"}, {"key": "atraente", "source": "creation"}],
     "extra_funds": 0,                     # pontos de Complicação gastos em +100% de recursos
     "xp": 0, "advances": [...],           # Progressos feitos (cada 5 XP)
     "bennies": 3, "fatigue": 0, "shaken": false}

Criação (pág. 54): d4 em tudo e 5 pontos de atributo (1 por tipo de dado); 15 pontos de perícia (1 por tipo
de dado até o atributo associado, 2 acima). Complicações dão até 4 pontos (1 Maior = 2, 2 Menores = 1 cada):
2 pontos compram um atributo ou uma Vantagem; 1 ponto compra um ponto de perícia ou dobra os recursos.
Aparar = 2 + metade de Lutar; Resistência = 2 + metade do Vigor; Movimentação 6. Os ferimentos usam o PV
da ficha: 3 ferimentos, o quarto incapacita.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.rulesets.schema import Ancestry, RulesetPack, TraitDef, TraitEffects
from app.services.character_rules import RulesError

DICE = (4, 6, 8, 10, 12)
WOUNDS = 3
# Estas Vantagens podem ser escolhidas mais de uma vez (cada uma com sua anotação).
REPEATABLE = {"novo-poder", "pontos-de-poder", "arma-predileta", "erudito", "profissional", "especialista", "mestre"}


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SkillIn(_In):
    key: str = Field(max_length=64)
    die: int
    note: str = Field(default="", max_length=60)


class TraitIn(_In):
    key: str = Field(max_length=64)
    severity: Literal["minor", "major"] | None = None
    # creation: escolhida na criação; advance: Progresso; race: veio com a raça.
    source: Literal["creation", "advance", "race"] = "creation"
    note: str = Field(default="", max_length=80)


class BuildIn(_In):
    attributes: dict[str, int] = Field(default_factory=dict)
    skills: list[SkillIn] = Field(default_factory=list, max_length=60)
    traits: list[TraitIn] = Field(default_factory=list, max_length=120)
    extra_funds: int = Field(default=0, ge=0, le=4)
    xp: int = Field(default=0, ge=0, le=100000)
    advances: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    bennies: int | None = Field(default=None, ge=0, le=99)
    fatigue: int = Field(default=0, ge=0, le=2)
    shaken: bool = False


class AdvanceIn(_In):
    type: Literal["edge", "attribute", "skill", "skills", "new_skill"]
    key: str | None = Field(default=None, max_length=64)
    keys: list[str] = Field(default_factory=list, max_length=2)
    note: str = Field(default="", max_length=80)


def step(die: int) -> int:
    if die not in DICE:
        raise RulesError("Os dados vão de d4 a d12.")
    return DICE.index(die)


def die_label(die: int, modifier: int = 0) -> str:
    return f"d{die}" + (f"{modifier:+d}" if modifier else "")


def default_build(pack: RulesetPack) -> dict[str, Any]:
    return {
        "attributes": {a.key: 4 for a in pack.attributes},
        "skills": [],
        "traits": [],
        "extra_funds": 0,
        "xp": 0,
        "advances": [],
        "bennies": None,
        "fatigue": 0,
        "shaken": False,
    }


def _ancestry(pack: RulesetPack, key: str | None) -> Ancestry | None:
    return pack.ancestry(key) if key else None


def start_dice(pack: RulesetPack, ancestry: Ancestry | None) -> dict[str, int]:
    bonus = ancestry.bonuses if ancestry else {}
    return {a.key: DICE[min(len(DICE) - 1, bonus.get(a.key, 0))] for a in pack.attributes}


def _effects(pack: RulesetPack, ancestry: Ancestry | None, build: BuildIn) -> dict[str, int]:
    total = dict.fromkeys(TraitEffects.model_fields, 0)
    sources = [ancestry.effects] if ancestry else []
    sources += [pack.trait(t.key).effects for t in build.traits if pack.trait(t.key)]
    for effects in sources:
        for field, value in effects.model_dump().items():
            total[field] += value
    return total


def skill_cost(die: int, attribute_die: int, free_die: int = 0) -> int:
    """1 ponto por tipo de dado até o atributo associado, 2 acima; o dado grátis da raça não conta."""
    cost = 0
    for d in DICE[: step(die) + 1]:
        if d <= free_die:
            continue
        cost += 1 if d <= attribute_die else 2
    return cost


def _parse(pack: RulesetPack, data: Mapping[str, Any]) -> BuildIn:
    try:
        build = BuildIn.model_validate({**default_build(pack), **data})
    except ValidationError as exc:
        raise RulesError(f"Ficha inválida: {exc.errors()[0]['msg']}") from exc
    if set(build.attributes) != {a.key for a in pack.attributes}:
        raise RulesError("Informe os cinco atributos.")
    for value in build.attributes.values():
        step(value)
    seen: set[tuple[str, str]] = set()
    for skill in build.skills:
        defn = pack.skill(skill.key)
        if defn is None:
            raise RulesError("Perícia desconhecida.")
        step(skill.die)
        ident = (skill.key, skill.note.strip().lower())
        if ident in seen:
            raise RulesError(f"{defn.name} está repetida.")
        seen.add(ident)
    for trait in build.traits:
        defn = pack.trait(trait.key)
        if defn is None or defn.kind not in ("edge", "hindrance", "power"):
            raise RulesError("Vantagem, Complicação ou Poder desconhecido.")
        if defn.kind == "hindrance":
            if defn.severity == "either" and trait.severity is None:
                raise RulesError(f"{defn.name}: escolha Menor ou Maior.")
            if defn.severity in ("minor", "major") and trait.severity not in (None, defn.severity):
                raise RulesError(f"{defn.name} é uma Complicação {'Menor' if defn.severity == 'minor' else 'Maior'}.")
    keys = [(t.key, t.note.strip().lower()) for t in build.traits if t.key not in REPEATABLE]
    if len(keys) != len(set(keys)):
        raise RulesError("Uma Vantagem ou Complicação está repetida.")
    return build


def known(pack: RulesetPack, data: Mapping[str, Any]) -> dict[str, Any]:
    """Ignora itens que o pacote não tem mais, para a ficha continuar abrindo depois de uma atualização."""
    traits = [
        t
        for t in data.get("traits") or []
        if (d := pack.trait(str(t.get("key", "")))) and d.kind in ("edge", "hindrance", "power")
    ]
    skills = [s for s in data.get("skills") or [] if pack.skill(str(s.get("key", "")))]
    return {**data, "traits": traits, "skills": skills}


def _with_race(pack: RulesetPack, ancestry: Ancestry | None, build: BuildIn) -> BuildIn:
    """A raça traz Complicações e perícias próprias: garante que estejam na ficha."""
    traits = [t for t in build.traits if t.source != "race" or (ancestry and t.key in ancestry.granted_traits)]
    have = {t.key for t in traits}
    for key in ancestry.granted_traits if ancestry else []:
        if key not in have:
            defn = pack.trait(key)
            severity = "major" if defn.severity in ("major", "either") else "minor"
            traits.append(TraitIn(key=key, severity=severity, source="race"))
    skills = list(build.skills)
    for key, die in (ancestry.free_skills if ancestry else {}).items():
        current = next((s for s in skills if s.key == key), None)
        if current is None:
            skills.append(SkillIn(key=key, die=die))
        elif current.die < die:
            skills[skills.index(current)] = current.model_copy(update={"die": die})
    starts = start_dice(pack, ancestry)
    attributes = {k: max(v, starts[k]) for k, v in build.attributes.items()}
    return build.model_copy(update={"traits": traits, "skills": skills, "attributes": attributes})


def normalize(
    pack: RulesetPack,
    ancestry_key: str | None,
    current: Mapping[str, Any] | None,
    patch: Mapping[str, Any],
    *,
    complete: bool,
) -> dict[str, Any]:
    ancestry = _ancestry(pack, ancestry_key)
    before = _parse(pack, {**default_build(pack), **(current or {})})
    merged = {**before.model_dump(), **patch}
    build = _with_race(pack, ancestry, _parse(pack, merged))
    if complete:
        # Depois de pronta, a ficha só muda por Progresso (Poderes, Benes e Fadiga continuam livres).
        def structure(b: BuildIn) -> tuple:
            core = sorted((t.key, t.severity or "", t.note) for t in b.traits if pack.trait(t.key).kind != "power")
            return (
                b.attributes,
                sorted((s.key, s.die, s.note) for s in b.skills),
                core,
                b.extra_funds,
                b.xp,
                b.advances,
            )

        if structure(build) != structure(before):
            raise RulesError("A ficha já está pronta: atributos, perícias e Vantagens mudam com um Progresso.")
    return build.model_dump()


def rank_index(pack: RulesetPack, xp: int) -> int:
    rules = pack.savage
    per_rank = rules.xp_per_advance * 4 if rules else 20
    return min(4, xp // per_rank)


def advances_earned(pack: RulesetPack, xp: int) -> int:
    rules = pack.savage
    legendary = rules.legendary_xp if rules else 80
    if xp < legendary:
        return xp // (rules.xp_per_advance if rules else 5)
    base = legendary // (rules.xp_per_advance if rules else 5)
    return base + (xp - legendary) // (rules.legendary_xp_per_advance if rules else 10)


def _rank_names(pack: RulesetPack) -> list[str]:
    return pack.savage.ranks if pack.savage else ["Novato", "Experiente", "Veterano", "Heroico", "Lendário"]


def _creation(pack: RulesetPack, ancestry: Ancestry | None, build: BuildIn, effects: dict[str, int]) -> dict[str, Any]:
    """Orçamento da criação: atributos, perícias e o que as Complicações pagam."""
    rules = pack.savage
    starts = start_dice(pack, ancestry)
    # Tira o que veio de Progressos para conferir só a criação.
    attrs = dict(build.attributes)
    skills = {(s.key, s.note): s.die for s in build.skills}
    for adv in build.advances:
        for key in adv.get("attributes", []):
            attrs[key] = DICE[step(attrs[key]) - 1]
        for key in adv.get("skills", []):
            match = next((k for k in skills if k[0] == key), None)
            if match:
                skills[match] = DICE[step(skills[match]) - 1]
        for key in adv.get("new_skills", []):
            skills.pop(next(k for k in skills if k[0] == key), None)
    attr_spent = sum(step(v) - step(starts[k]) for k, v in attrs.items())
    free = ancestry.free_skills if ancestry else {}
    skill_spent = sum(
        skill_cost(die, attrs[pack.skill(key).attribute], free.get(key, 0)) for (key, _note), die in skills.items()
    )
    majors = minors = 0
    for t in build.traits:
        defn = pack.trait(t.key)
        if defn.kind == "hindrance" and t.source == "creation":
            if (t.severity or defn.severity) == "major":
                majors += 1
            else:
                minors += 1
    hindrance_points = min(majors, rules.major_hindrances_max) * 2 + min(minors, rules.minor_hindrances_max)
    hindrance_points = min(hindrance_points, rules.hindrance_points_max)
    edges = sum(1 for t in build.traits if t.source == "creation" and pack.trait(t.key).kind == "edge")
    free_edges = ancestry.free_edges if ancestry else 0
    attr_budget = rules.attribute_points + effects["attribute_points"]
    skill_budget = rules.skill_points + effects["skill_points"]
    needed = (
        2 * max(0, attr_spent - attr_budget)
        + max(0, skill_spent - skill_budget)
        + 2 * max(0, edges - free_edges)
        + build.extra_funds
    )
    return {
        "attributes": {"spent": attr_spent, "budget": attr_budget},
        "skills": {"spent": skill_spent, "budget": skill_budget},
        "edges": {"taken": edges, "free": free_edges},
        "hindrances": {"points": hindrance_points, "spent": needed, "majors": majors, "minors": minors},
        "funds": rules.starting_funds * (2**build.extra_funds),
    }


def _unmet(pack: RulesetPack, defn: TraitDef, build: BuildIn, rank: int) -> list[str]:
    req = defn.requirements
    if req is None:
        return []
    names = _rank_names(pack)
    out = []
    if req.rank > rank:
        out.append(names[req.rank])
    attr_name = {a.key: a.name for a in pack.attributes}
    for key, die in req.attributes.items():
        if build.attributes.get(key, 4) < die:
            out.append(f"{attr_name[key]} d{die}")
    skill_dice = {}
    for s in build.skills:
        skill_dice[s.key] = max(skill_dice.get(s.key, 0), s.die)
    for key, die in req.skills.items():
        if skill_dice.get(key, 0) < die:
            out.append(f"{pack.skill(key).name} d{die}")
    owned = {t.key for t in build.traits}
    for key in req.edges:
        if key not in owned:
            out.append(pack.trait(key).name)
    return out


def sheet(pack: RulesetPack, ancestry_key: str | None, data: Mapping[str, Any], *, complete: bool) -> dict[str, Any]:
    rules = pack.savage
    ancestry = _ancestry(pack, ancestry_key)
    build = _parse(pack, known(pack, data))
    effects = _effects(pack, ancestry, build)
    rank = rank_index(pack, build.xp)
    names = _rank_names(pack)
    fighting = max((s.die for s in build.skills if s.key == "lutar"), default=0)
    parry = 2 + fighting // 2 + effects["parry"]
    toughness = 2 + build.attributes["vig"] // 2 + effects["toughness"]
    pace = rules.base_pace + effects["pace"]
    bennies_max = rules.bennies + effects["bennies"]
    has_arcane = any(t.key == "antecedente-arcano" for t in build.traits)
    creation = _creation(pack, ancestry, build, effects)
    earned = advances_earned(pack, build.xp)
    attr_name = {a.key: a for a in pack.attributes}

    skills = []
    for s in build.skills:
        defn = pack.skill(s.key)
        skills.append(
            {
                "key": s.key,
                "name": defn.name + (f" ({s.note})" if s.note else ""),
                "die": s.die,
                "label": die_label(s.die),
                "attribute": attr_name[defn.attribute].abbr,
                "category": defn.category,
                "page": defn.page,
            }
        )
    traits = []
    warnings = []
    for t in build.traits:
        defn = pack.trait(t.key)
        severity = t.severity or defn.severity
        item = {
            "key": t.key,
            "name": defn.name,
            "note": t.note,
            "kind": defn.kind,
            "source": t.source,
            "page": defn.page,
        }
        if defn.kind == "hindrance":
            item["severity"] = severity
        if defn.kind in ("edge", "power"):
            unmet = _unmet(pack, defn, build, rank)
            if unmet:
                item["unmet"] = unmet
                warnings.append(f"{defn.name}: falta {', '.join(unmet)}.")
            if defn.requirements and defn.requirements.other:
                item["check"] = defn.requirements.other
        if defn.info:
            item["info"] = defn.info
        traits.append(item)

    if not complete:
        c = creation
        if c["attributes"]["spent"] < c["attributes"]["budget"]:
            warnings.append(f"Ainda há {c['attributes']['budget'] - c['attributes']['spent']} ponto(s) de atributo.")
        if c["skills"]["spent"] < c["skills"]["budget"]:
            warnings.append(f"Ainda há {c['skills']['budget'] - c['skills']['spent']} ponto(s) de perícia.")
        if c["hindrances"]["spent"] > c["hindrances"]["points"]:
            warnings.append(
                f"Gastou {c['hindrances']['spent']} pontos de Complicação e só tem {c['hindrances']['points']}."
            )
        if (
            c["hindrances"]["majors"] > rules.major_hindrances_max
            or c["hindrances"]["minors"] > rules.minor_hindrances_max
        ):
            warnings.append("Só 1 Complicação Maior e 2 Menores dão pontos; as outras são só interpretação.")

    derived = [
        {"key": "pace", "label": "Movimentação", "value": pace},
        {"key": "parry", "label": "Aparar", "value": parry},
        {"key": "toughness", "label": "Resistência", "value": toughness},
        {"key": "charisma", "label": "Carisma", "value": f"{effects['charisma']:+d}" if effects["charisma"] else "0"},
        {
            "key": "bennies",
            "label": "Benes",
            "value": bennies_max,
            "current": bennies_max if build.bennies is None else build.bennies,
        },
        {
            "key": "load",
            "label": "Limite de Carga",
            "value": f"{build.attributes['for'] * 2.5:g} kg".replace(".", ","),
        },
    ]
    if has_arcane:
        power_points = 10 + 5 * sum(1 for t in build.traits if t.key == "pontos-de-poder")
        derived.append({"key": "power_points", "label": "Pontos de Poder", "value": power_points})
    return {
        "engine": "savage",
        "rank": {"index": rank, "name": names[rank]},
        "xp": build.xp,
        "advances": {
            "earned": earned,
            "taken": len(build.advances),
            "available": max(0, earned - len(build.advances)),
        },
        "creation": creation,
        "derived": derived,
        "attributes": [
            {"key": k, "name": attr_name[k].name, "die": v, "label": die_label(v)} for k, v in build.attributes.items()
        ],
        "skills": skills,
        "traits": traits,
        "wounds": {"max": WOUNDS},
        "fatigue": build.fatigue,
        "shaken": build.shaken,
        "checks": checks(pack, build, skills),
        "warnings": warnings,
    }


def checks(pack: RulesetPack, build: BuildIn, skills: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Dado da característica (explode) + Dado Selvagem, dificuldade 4. Sem a perícia: d4-2."""
    out = [
        {
            "key": a.key,
            "label": a.name,
            "notation": f"1d{build.attributes[a.key]}!",
            "wild": True,
            "target": 4,
            "group": "Atributos",
        }
        for a in pack.attributes
    ]
    for s in skills:
        group = "Arcanas" if s["category"] == "Arcana" else "Perícias"
        out.append(
            {
                "key": s["key"],
                "label": s["name"],
                "notation": f"1d{s['die']}!",
                "wild": True,
                "target": 4,
                "group": group,
            }
        )
    out.append(
        {
            "key": "sem-treino",
            "label": "Sem treino",
            "notation": "1d4!-2",
            "wild": True,
            "target": 4,
            "group": "Perícias",
        }
    )
    return out


def hp_max() -> int:
    return WOUNDS


def missing(pack: RulesetPack, ancestry_key: str | None, data: Mapping[str, Any]) -> list[str]:
    ancestry = _ancestry(pack, ancestry_key)
    build = _parse(pack, known(pack, data))
    out = []
    if pack.ancestries and ancestry is None:
        out.append("ancestry")
    creation = _creation(pack, ancestry, build, _effects(pack, ancestry, build))
    if creation["hindrances"]["spent"] > creation["hindrances"]["points"]:
        out.append("points")
    for t in build.traits:
        defn = pack.trait(t.key)
        if defn.kind == "edge" and defn.requirements and defn.requirements.rank > 0 and t.source == "creation":
            out.append("edges")
            break
    return out


def level_label(pack: RulesetPack, data: Mapping[str, Any]) -> str:
    return _rank_names(pack)[rank_index(pack, int(data.get("xp", 0)))]


def gain(data: Mapping[str, Any], amount: int) -> dict[str, Any]:
    return {**data, "xp": int(data.get("xp", 0)) + amount}


def advance(
    pack: RulesetPack, ancestry_key: str | None, data: Mapping[str, Any], choice: AdvanceIn
) -> tuple[dict[str, Any], str]:
    """Aplica um Progresso (pág. 53). Devolve (ficha nova, texto para o log)."""
    ancestry = _ancestry(pack, ancestry_key)
    build = _parse(pack, data)
    rank = rank_index(pack, build.xp)
    if advances_earned(pack, build.xp) <= len(build.advances):
        raise RulesError("Nenhum Progresso disponível: são 5 XP por Progresso.")
    record: dict[str, Any] = {"type": choice.type, "rank": rank, "at": datetime.now(UTC).isoformat(timespec="seconds")}
    attrs = dict(build.attributes)
    skills = list(build.skills)
    traits = list(build.traits)
    attr_by_key = {a.key: a for a in pack.attributes}

    def skill_entry(key: str) -> SkillIn:
        entry = next((s for s in skills if s.key == key), None)
        if entry is None:
            raise RulesError("O personagem não tem essa perícia.")
        return entry

    def raise_skill(entry: SkillIn) -> None:
        if entry.die >= 12:
            raise RulesError(f"{pack.skill(entry.key).name} já está em d12.")
        skills[skills.index(entry)] = entry.model_copy(update={"die": DICE[step(entry.die) + 1]})

    if choice.type == "edge":
        defn = pack.trait(choice.key or "")
        if defn is None or defn.kind != "edge":
            raise RulesError("Escolha uma Vantagem.")
        if any(t.key == defn.key for t in traits) and defn.key not in REPEATABLE:
            raise RulesError(f"O personagem já tem {defn.name}.")
        unmet = _unmet(pack, defn, build, rank)
        if unmet:
            raise RulesError(f"Faltam requisitos para {defn.name}: {', '.join(unmet)}.")
        traits.append(TraitIn(key=defn.key, source="advance", note=choice.note))
        record["edges"] = [defn.key]
        text = f"nova Vantagem {defn.name}"
    elif choice.type == "attribute":
        key = choice.key or ""
        if key not in attrs:
            raise RulesError("Escolha um atributo.")
        if rank < 4 and any(a["type"] == "attribute" and a.get("rank") == rank for a in build.advances):
            raise RulesError("Aumentar atributo só uma vez por Estágio.")
        if attrs[key] >= 12:
            raise RulesError("Esse atributo já está em d12.")
        attrs[key] = DICE[step(attrs[key]) + 1]
        record["attributes"] = [key]
        text = f"{attr_by_key[key].name} sobe para d{attrs[key]}"
    elif choice.type == "skill":
        entry = skill_entry(choice.key or "")
        linked = attrs[pack.skill(entry.key).attribute]
        if entry.die < linked:
            raise RulesError("Uma perícia só sobe sozinha se estiver igual ou acima do atributo associado.")
        raise_skill(entry)
        record["skills"] = [entry.key]
        text = f"{pack.skill(entry.key).name} sobe para d{DICE[step(entry.die) + 1]}"
    elif choice.type == "skills":
        if len(set(choice.keys)) != 2:
            raise RulesError("Escolha duas perícias diferentes.")
        names = []
        for key in choice.keys:
            entry = skill_entry(key)
            if entry.die >= attrs[pack.skill(key).attribute]:
                raise RulesError(f"{pack.skill(key).name} não está abaixo do atributo associado.")
            raise_skill(entry)
            names.append(pack.skill(key).name)
        record["skills"] = list(choice.keys)
        text = f"{' e '.join(names)} sobem um tipo de dado"
    else:
        defn = pack.skill(choice.key or "")
        if defn is None:
            raise RulesError("Escolha uma perícia.")
        if any(s.key == defn.key and s.note == choice.note for s in skills):
            raise RulesError("O personagem já tem essa perícia.")
        if defn.specialize and not choice.note.strip():
            raise RulesError(f"{defn.name} precisa de um campo (ex.: {defn.name} (Arcano)).")
        skills.append(SkillIn(key=defn.key, die=4, note=choice.note))
        record["new_skills"] = [defn.key]
        text = f"nova perícia {defn.name} d4"
    updated = build.model_copy(
        update={"attributes": attrs, "skills": skills, "traits": traits, "advances": [*build.advances, record]}
    )
    return _with_race(pack, ancestry, updated).model_dump(), text
