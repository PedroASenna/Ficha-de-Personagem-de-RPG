"""Motores de ficha com regras próprias (GURPS e Savage Worlds).

Os sistemas "clássicos" (5ª edição, genérico) usam raça/classe/antecedente e atributos, em
``character_rules``. Os motores daqui guardam a ficha em ``character.build`` e calculam o resto: pontos,
derivadas, testes prontos para rolar e avisos. O app só mostra o que o servidor calculou.
"""

from typing import Any

from app.models import Character
from app.models.enums import CharacterStatus
from app.rulesets.schema import RulesetPack
from app.services.character_rules import RulesError
from app.services.engines import gurps, savage

# Só mudam pelos endpoints de experiência e de Progresso, nunca pelo PATCH da ficha.
PROTECTED = {"earned", "xp", "advances"}


def uses_engine(pack: RulesetPack) -> bool:
    return pack.engine != "classic"


def default_build(pack: RulesetPack) -> dict[str, Any]:
    if pack.engine == "gurps":
        return gurps.default_build(pack)
    if pack.engine == "savage":
        return savage.default_build(pack)
    return {}


def _complete(character: Character) -> bool:
    return character.status == CharacterStatus.COMPLETE


def update_build(pack: RulesetPack, character: Character, patch: dict[str, Any]) -> None:
    """PATCH da ficha: valida, grava e recalcula atributos e PV."""
    if PROTECTED & set(patch):
        raise RulesError("Experiência e Progressos não mudam por aqui.")
    current = character.build or default_build(pack)
    if pack.engine == "gurps":
        if _complete(character) and "points" in patch and patch["points"] != current.get("points"):
            raise RulesError("Os pontos iniciais ficam fixos depois de pronto; o Mestre dá pontos novos.")
        updated = gurps.normalize(pack, current, patch)
        if _complete(character):
            # Pronto: só gasta o que tem (mudanças que devolvem pontos continuam valendo).
            after = gurps.unspent(pack, updated)
            if after < 0 and after < gurps.unspent(pack, current):
                raise RulesError(f"Faltam {-after} pontos para isso. O Mestre dá pontos novos ao fim da aventura.")
        character.build = updated
    else:
        character.build = savage.normalize(pack, character.ancestry_key, current, patch, complete=_complete(character))
    refresh(pack, character)


def refresh(pack: RulesetPack, character: Character) -> None:
    """Depois de mexer na ficha ou na raça: atributos finais e PV máximo (o dano sofrido continua)."""
    if pack.engine == "savage":
        # A raça pode trazer Complicações e perícias: normaliza de novo com a raça atual.
        character.build = savage.normalize(
            pack, character.ancestry_key, character.build or savage.default_build(pack), {}, complete=False
        )
    build = character.build or default_build(pack)
    character.attributes = dict(build["attributes"])
    new_max = gurps.hp_max(build) if pack.engine == "gurps" else savage.hp_max()
    if character.status != CharacterStatus.COMPLETE:
        character.hp_max = character.hp_current = new_max
        return
    diff = new_max - character.hp_max
    character.hp_max = new_max
    character.hp_current = max(0, min(new_max, character.hp_current + diff))


def sheet(pack: RulesetPack, character: Character) -> dict[str, Any]:
    build = character.build or default_build(pack)
    if pack.engine == "gurps":
        return gurps.sheet(pack, build)
    return savage.sheet(pack, character.ancestry_key, build, complete=_complete(character))


def missing(pack: RulesetPack, character: Character) -> list[str]:
    build = character.build or default_build(pack)
    if pack.engine == "gurps":
        return gurps.missing(pack, build)
    return savage.missing(pack, character.ancestry_key, build)


def level_label(pack: RulesetPack, character: Character) -> str:
    build = character.build or default_build(pack)
    if pack.engine == "gurps":
        return gurps.level_label(build)
    return savage.level_label(pack, build)


def gain(pack: RulesetPack, character: Character, amount: int) -> str:
    """O Mestre dá pontos (GURPS) ou XP (Savage). Devolve o texto do log."""
    if amount <= 0:
        raise RulesError("Informe quantos pontos ou XP o personagem ganha.")
    build = character.build or default_build(pack)
    if pack.engine == "gurps":
        character.build = gurps.gain(build, amount)
        return f"{character.name} ganhou {amount} ponto{'s' if amount > 1 else ''} de personagem ({level_label(pack, character)})"
    before = savage.advances_earned(pack, int(build.get("xp", 0)))
    character.build = savage.gain(build, amount)
    info = savage.sheet(pack, character.ancestry_key, character.build, complete=True)
    new = savage.advances_earned(pack, info["xp"]) - before
    extra = f", {new} Progresso{'s' if new > 1 else ''} novo{'s' if new > 1 else ''}" if new else ""
    return f"{character.name} ganhou {amount} XP ({info['rank']['name']}{extra})"


def advance(pack: RulesetPack, character: Character, choice: savage.AdvanceIn) -> str:
    if pack.engine != "savage":
        raise RulesError("Progressos são do Savage Worlds.")
    if character.status != CharacterStatus.COMPLETE:
        raise RulesError("Conclua o personagem antes do primeiro Progresso.")
    character.build, text = savage.advance(pack, character.ancestry_key, character.build or {}, choice)
    refresh(pack, character)
    return f"{character.name} fez um Progresso: {text}"


def quick_build(pack: RulesetPack) -> tuple[str | None, dict[str, Any]]:
    """Personagem expresso: (raça, ficha) válidos e jogáveis, para o jogador ajustar depois."""
    if pack.engine == "gurps":
        return None, gurps.default_build(pack)
    build = savage.default_build(pack)
    build["attributes"] = dict.fromkeys(build["attributes"], 6)
    picks = ["lutar", "perceber", "atirar", "furtividade", "persuasao", "curar", "intimidacao"]
    build["skills"] = [{"key": k, "die": 6, "note": ""} for k in picks if pack.skill(k)]
    build["skills"].append({"key": "nadar", "die": 4, "note": ""})
    if pack.trait("prontidao"):
        build["traits"] = [{"key": "prontidao", "source": "creation"}]
    ancestry = "humanos" if pack.ancestry("humanos") else None
    return ancestry, build
