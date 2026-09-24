"""GURPS 4ª Edição e Savage Worlds: pacotes, dados que explodem, testes e fichas."""

import json
import random

import pytest

from app.rulesets.loader import get_registry
from app.services import dice
from app.services.character_rules import RulesError
from app.services.engines import gurps, savage
from tests.conftest import API, auth, receive_until, register

GURPS = get_registry().get("gurps-4e")
SAVAGE = get_registry().get("savage-worlds")


class FixedRng(random.Random):
    """RNG com resultados escolhidos, na ordem."""

    def __init__(self, values: list[int]) -> None:
        super().__init__(0)
        self.values = list(values)

    def randint(self, a: int, b: int) -> int:
        value = self.values.pop(0)
        assert a <= value <= b
        return value


# ---------- pacotes ----------


def test_packs_bring_book_lists_without_rules_text():
    kinds = {t.kind for t in GURPS.traits}
    assert kinds == {"advantage", "disadvantage", "perk", "quirk"}
    assert len(GURPS.traits) > 450 and len(GURPS.skills) > 350
    assert GURPS.trait("aptidao-magica").cost.per_level == [10] and GURPS.trait("aptidao-magica").cost.base == 5
    assert GURPS.trait("furia").cost.self_control
    assert GURPS.skill("culinaria").attribute == "iq"  # a lista do livro diz DX; a descrição, IQ
    assert GURPS.skill("espadas-curtas").default == -5
    assert "Steve Jackson Games" in GURPS.attribution
    assert {t.kind for t in SAVAGE.traits} == {"edge", "hindrance", "power"}
    assert len([t for t in SAVAGE.traits if t.kind == "edge"]) > 100
    assassino = SAVAGE.trait("assassino").requirements
    assert assassino.attributes == {"agi": 8} and assassino.skills == {"escalar": 6, "furtividade": 8, "lutar": 6}
    assert SAVAGE.trait("bloquear-aprimorado").requirements.rank == 2
    assert "Pinnacle" in SAVAGE.attribution


def test_ruleset_list_reports_engine(client):
    listed = {r["id"]: r for r in client.get(f"{API}/rulesets").json()}
    assert listed["gurps-4e"]["engine"] == "gurps" and listed["savage-worlds"]["engine"] == "savage"
    assert listed["srd-5.1"]["engine"] == "classic"


# ---------- dados ----------


def test_exploding_dice_notation_and_roll():
    expression = dice.parse("1d8!+1")
    assert expression.canonical() == "1d8!+1"
    result = dice.roll(expression, FixedRng([8, 8, 3]))
    die = result.terms[0].dice[0]
    assert die.value == 19 and die.rolls == (8, 8, 3) and result.total == 20
    assert result.to_dict()["terms"][0]["dice"][0]["rolls"] == [8, 8, 3]
    with pytest.raises(dice.NotationError):
        dice.parse("1d2!")


@pytest.mark.parametrize(
    ("total", "target", "success", "critical"),
    [
        (3, 3, True, True),
        (4, 2, True, True),
        (5, 15, True, True),
        (5, 14, True, False),
        (6, 16, True, True),
        (6, 15, True, False),
        (16, 16, True, False),
        (17, 16, False, False),
        (17, 15, False, True),
        (18, 20, False, True),
        (16, 6, False, True),  # 10 acima do NH
        (15, 6, False, False),
    ],
)
def test_gurps_critical_table(total, target, success, critical):
    assert dice.gurps_verdict(total, target) == (success, critical)


def test_gurps_check_and_summary():
    checked = dice.run_check("gurps", dice.parse("3d6"), target=12, rng=FixedRng([2, 3, 4]))
    assert checked.check == {"kind": "gurps", "target": 12, "success": True, "critical": False, "margin": 3}
    assert checked.outcome.tier == dice.Tier.HIGH
    assert dice.check_suffix(checked.check) == " contra 12 — sucesso por 3"
    crit = dice.run_check("gurps", dice.parse("3d6"), target=16, rng=FixedRng([1, 2, 3]))
    assert crit.outcome.tier == dice.Tier.CRITICAL_SUCCESS
    assert dice.check_suffix(crit.check).endswith("SUCESSO DECISIVO!")


def test_savage_wild_die_raises_and_snake_eyes():
    # d8 explode (8+3 = 11) e o selvagem tira 2: fica com 11, dificuldade 4 → uma ampliação (4+4 = 8 ≤ 11 < 12).
    checked = dice.run_check("savage", dice.parse("1d8!"), target=None, wild=True, rng=FixedRng([8, 3, 2]))
    assert checked.total == 11 and checked.check["raises"] == 1 and checked.check["success"]
    assert checked.outcome.tier == dice.Tier.CRITICAL_SUCCESS
    terms = checked.roll["terms"]
    assert terms[1]["wild"] and terms[0]["dice"][0]["kept"] and not terms[1]["dice"][0]["kept"]
    # Selvagem ganha: o dado da perícia fica esmaecido.
    wild_wins = dice.run_check("savage", dice.parse("1d4!-2"), target=None, wild=True, rng=FixedRng([2, 6, 5]))
    assert wild_wins.total == 9 and not wild_wins.roll["terms"][0]["dice"][0]["kept"]
    snake = dice.run_check("savage", dice.parse("1d10!"), target=None, wild=True, rng=FixedRng([1, 1]))
    assert snake.check["critical"] and not snake.check["success"]
    assert snake.outcome.tier == dice.Tier.CRITICAL_FAILURE
    assert "olhos de cobra" in dice.check_suffix(snake.check)
    # Extras (sem Dado Selvagem) não têm falha crítica.
    extra = dice.run_check("savage", dice.parse("1d6!"), target=4, wild=False, rng=FixedRng([1]))
    assert not extra.check["critical"] and extra.outcome.tier == dice.Tier.LOW


def test_roll_request_plain_roll_ignores_wild_outside_savage():
    roll, _outcome, check, _total, shown = dice.roll_request(
        "gurps", "2d6", target=None, wild=True, rules=dice.OutcomeRules()
    )
    assert check is None and shown == "2d6" and len(roll["terms"]) == 1


# ---------- GURPS ----------


def gurps_build(**changes):
    build = gurps.default_build(GURPS)
    build.update(changes)
    return build


def test_gurps_skill_and_trait_costs():
    assert [gurps.skill_step(p) for p in (1, 2, 4, 8, 12, 20)] == [0, 1, 2, 3, 4, 6]
    with pytest.raises(RulesError):
        gurps.skill_step(3)
    trait = gurps.TraitIn
    assert gurps.trait_cost(GURPS.trait("ambidestria"), trait(key="ambidestria")) == 5
    assert gurps.trait_cost(GURPS.trait("aptidao-magica"), trait(key="aptidao-magica", level=2)) == 25
    hierarquia = GURPS.trait("hierarquia-militar")
    assert gurps.trait_cost(hierarquia, trait(key="hierarquia-militar", level=3, per=10)) == 30
    with pytest.raises(RulesError):
        gurps.trait_cost(hierarquia, trait(key="hierarquia-militar", per=7))
    furia = GURPS.trait("furia")
    listed = furia.cost.fixed
    assert gurps.trait_cost(furia, trait(key="furia")) == listed
    assert gurps.trait_cost(furia, trait(key="furia", self_control=6)) == listed * 2
    assert gurps.trait_cost(furia, trait(key="furia", self_control=15)) == int(listed * 0.5)
    with pytest.raises(RulesError):
        gurps.trait_cost(GURPS.trait("aliados"), trait(key="aliados"))  # "Variável": precisa informar
    with pytest.raises(RulesError):
        gurps.trait_cost(GURPS.trait("aliados"), trait(key="aliados", base_cost=-5))


def test_gurps_sheet_points_derived_and_magery():
    build = gurps_build(
        attributes={"st": 11, "dx": 12, "iq": 13, "ht": 10},
        secondary={"hp": 2, "will": 0, "per": 1, "fp": 0, "speed": 1, "move": 0},
        traits=[{"key": "aptidao-magica", "level": 1}, {"key": "peculiaridade", "note": "Coleciona moedas"}],
        skills=[{"key": "espadas-curtas", "points": 4}, {"key": "magica-bola-de-fogo", "points": 1}],
    )
    sheet = gurps.sheet(GURPS, gurps.normalize(GURPS, None, build))
    points = sheet["points"]
    # Atributos 10 + 40 + 60 = 110; secundárias PV 4 + Per 5 + Vel 5 = 14; Aptidão 15; peculiaridade -1; perícias 5.
    assert points["breakdown"] == {
        "attributes": 110,
        "secondary": 14,
        "advantages": 15,
        "disadvantages": 0,
        "quirks": -1,
        "skills": 5,
    }
    assert points["spent"] == 143 and points["unspent"] == 7
    derived = {d["key"]: d["value"] for d in sheet["derived"]}
    assert derived["hp"] == 13 and derived["per"] == 14 and derived["speed"] == "5,75"
    assert derived["move"] == 5 and derived["dodge"] == 8 and derived["basic_lift"] == "12 kg"
    assert derived["damage"] == "GdP 1d-1 · GeB 1d+1"
    skills = {s["key"]: s for s in sheet["skills"]}
    assert skills["espadas-curtas"]["level"] == 13 and skills["espadas-curtas"]["relative"] == "DX+1"
    # Bola de Fogo (IQ/D) com 1 ponto: IQ-2 = 11, mais Aptidão Mágica 1 = 12.
    assert skills["magica-bola-de-fogo"]["level"] == 12
    checks = {c["key"]: c for c in sheet["checks"]}
    assert checks["espadas-curtas"] == {
        "key": "espadas-curtas",
        "label": "Espadas Curtas",
        "notation": "3d6",
        "target": 13,
        "group": "Perícias",
    }
    assert checks["dodge"]["target"] == 8 and checks["per"]["target"] == 14


def test_gurps_limits_block_finalize():
    over = gurps_build(attributes={"st": 10, "dx": 18, "iq": 10, "ht": 10})
    assert gurps.missing(GURPS, gurps.normalize(GURPS, None, over)) == ["points"]
    heavy = gurps_build(traits=[{"key": "maldicao"}, {"key": "mentalidade-de-escravo"}])
    assert "disadvantages" in gurps.missing(GURPS, gurps.normalize(GURPS, None, heavy))
    quirks = gurps_build(traits=[{"key": "peculiaridade", "note": f"mania {i}"} for i in range(6)])
    assert "quirks" in gurps.missing(GURPS, gurps.normalize(GURPS, None, quirks))
    with pytest.raises(RulesError):
        gurps.normalize(GURPS, None, gurps_build(skills=[{"key": "adestramento-de-animais", "points": 2}]))
    with pytest.raises(RulesError):
        gurps.normalize(GURPS, None, gurps_build(traits=[{"key": "peculiaridade"}]))


def test_gurps_character_flow_and_room_roll(client, connect):
    player, master = register(client, "Ana"), register(client, "Mestre")
    draft = client.post(
        f"{API}/characters", json={"ruleset_id": "gurps-4e", "name": "Dai"}, headers=auth(player)
    ).json()
    assert draft["sheet"]["points"]["total"] == 150 and draft["level_label"] == "150 pontos"
    build = {
        "attributes": {"st": 8, "dx": 15, "iq": 12, "ht": 12},
        "traits": [{"key": "cleptomania", "self_control": 12}],
        "skills": [{"key": "furtividade", "points": 2}, {"key": "espadas-curtas", "points": 8}],
    }
    r = client.patch(f"{API}/characters/{draft['id']}", json={"build": build}, headers=auth(player))
    assert r.status_code == 200, r.text
    sheet = r.json()
    assert sheet["hp_max"] == 8 and sheet["attributes"] == build["attributes"]
    assert (
        client.post(
            f"{API}/characters/{draft['id']}/attributes", json={"method": "manual"}, headers=auth(player)
        ).status_code
        == 422
    )
    done = client.post(f"{API}/characters/{draft['id']}/finalize", headers=auth(player))
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "complete"

    room = client.post(
        f"{API}/rooms", json={"name": "Infinito", "ruleset_id": "gurps-4e"}, headers=auth(master)
    ).json()
    joined = client.post(
        f"{API}/rooms/join", json={"pin": room["pin"], "character_id": draft["id"]}, headers=auth(player)
    )
    assert joined.status_code == 200, joined.text
    master_ws, _ = connect(room["pin"], master)
    player_ws, _ = connect(room["pin"], player)
    target = next(s["level"] for s in done.json()["sheet"]["skills"] if s["key"] == "espadas-curtas")
    player_ws.send_text(
        json.dumps(
            {
                "type": "roll.request",
                "id": "g1",
                "notation": "3d6",
                "target": target,
                "label": "Espadas Curtas",
                "character_id": draft["id"],
            }
        )
    )
    result = receive_until(master_ws, "roll.result")
    assert result["check"]["kind"] == "gurps" and result["check"]["target"] == target == 17
    assert result["summary"].startswith("Dai rolou 3d6 (Espadas Curtas) = ")
    assert " contra 17 — " in result["summary"]

    # O Mestre dá pontos; o jogador gasta subindo a perícia depois de pronto.
    r = client.post(
        f"{API}/rooms/{room['id']}/characters/{draft['id']}/level-up", json={"experience": 5}, headers=auth(master)
    )
    assert r.status_code == 200, r.text
    assert r.json()["level_label"] == "155 pontos"
    leveled = receive_until(player_ws, "character.leveled")
    assert leveled["summary"] == "Dai ganhou 5 pontos de personagem (155 pontos)"
    skills = [{"key": "furtividade", "points": 2}, {"key": "espadas-curtas", "points": 12}]
    r = client.patch(f"{API}/characters/{draft['id']}", json={"build": {"skills": skills}}, headers=auth(player))
    assert r.status_code == 200, r.text
    # Atributos 140, Cleptomania -15, perícias 2 + 12: 139 de 155.
    assert r.json()["sheet"]["points"]["unspent"] == 16
    # Pronto: não dá para gastar o que não tem (+20 pontos na perícia com 16 livres).
    skills[1]["points"] = 32
    r = client.patch(f"{API}/characters/{draft['id']}", json={"build": {"skills": skills}}, headers=auth(player))
    assert r.status_code == 422 and "Faltam 4 pontos" in r.json()["detail"]
    r = client.patch(f"{API}/characters/{draft['id']}", json={"build": {"earned": 50}}, headers=auth(player))
    assert r.status_code == 422
    r = client.post(f"{API}/characters/{draft['id']}/level-up", json={"attributes": {"st": 1}}, headers=auth(player))
    assert r.status_code == 422


# ---------- Savage Worlds ----------


def sw_build(**changes):
    build = savage.default_build(SAVAGE)
    build.update(changes)
    return build


def test_savage_skill_costs_and_race():
    assert savage.skill_cost(6, 6) == 2 and savage.skill_cost(8, 6) == 4 and savage.skill_cost(12, 4) == 9
    assert savage.skill_cost(6, 4, free_die=6) == 0
    anao = savage.normalize(SAVAGE, "anoes", None, {}, complete=False)
    assert anao["attributes"]["vig"] == 6
    sheet = savage.sheet(SAVAGE, "anoes", anao, complete=False)
    derived = {d["key"]: d["value"] for d in sheet["derived"]}
    assert derived["pace"] == 5 and derived["toughness"] == 5 and derived["parry"] == 2
    elfo = savage.normalize(SAVAGE, "elfos", None, {}, complete=False)
    assert {"key": "desastrado", "severity": "minor", "source": "race", "note": ""} in elfo["traits"]
    atlante = savage.normalize(SAVAGE, "atlante", None, {}, complete=False)
    assert atlante["skills"] == [{"key": "nadar", "die": 6, "note": ""}]
    assert savage.sheet(SAVAGE, "atlante", atlante, complete=False)["creation"]["skills"]["spent"] == 0


def test_savage_creation_budget_with_hindrances():
    build = sw_build(
        attributes={"agi": 8, "ast": 6, "esp": 6, "for": 6, "vig": 6},  # 6 pontos: 1 acima dos 5
        skills=[{"key": "lutar", "die": 8, "note": ""}, {"key": "atirar", "die": 6, "note": ""}],
        traits=[
            {"key": "feio", "source": "creation"},
            {"key": "codigo-de-honra", "source": "creation"},
            {"key": "atraente", "source": "creation"},
            {"key": "bloquear", "source": "creation"},
        ],
    )
    normalized = savage.normalize(SAVAGE, "humanos", None, build, complete=False)
    sheet = savage.sheet(SAVAGE, "humanos", normalized, complete=False)
    c = sheet["creation"]
    # Complicações: Maior (2) + Menor (1) = 3 pontos; gastos: 2 (atributo extra) + 0 (Atraente é a grátis
    # do humano) + 2 (Bloquear) = 4 → falta 1.
    assert c["hindrances"]["points"] == 3 and c["hindrances"]["spent"] == 4
    assert "points" in savage.missing(SAVAGE, "humanos", normalized)
    # Bloquear é de Experiente: não pode na criação.
    assert "edges" in savage.missing(SAVAGE, "humanos", normalized)
    derived = {d["key"]: d["value"] for d in sheet["derived"]}
    assert derived["parry"] == 2 + 4 + 1 and derived["charisma"] == "0"  # Atraente +2 e Feio -2
    with pytest.raises(RulesError):
        savage.normalize(SAVAGE, "humanos", None, sw_build(traits=[{"key": "fobia"}]), complete=False)


def test_savage_advances():
    base = savage.normalize(
        SAVAGE,
        "humanos",
        None,
        sw_build(
            attributes={"agi": 8, "ast": 6, "esp": 6, "for": 4, "vig": 6},
            skills=[{"key": "lutar", "die": 8, "note": ""}],
        ),
        complete=False,
    )
    with pytest.raises(RulesError, match="Nenhum Progresso"):
        savage.advance(SAVAGE, "humanos", base, savage.AdvanceIn(type="attribute", key="for"))
    rich = savage.gain(base, 10)
    after, text = savage.advance(SAVAGE, "humanos", rich, savage.AdvanceIn(type="attribute", key="for"))
    assert after["attributes"]["for"] == 6 and text == "Força sobe para d6"
    with pytest.raises(RulesError, match="uma vez por Estágio"):
        savage.advance(SAVAGE, "humanos", after, savage.AdvanceIn(type="attribute", key="vig"))
    after, _ = savage.advance(SAVAGE, "humanos", after, savage.AdvanceIn(type="skill", key="lutar"))
    assert after["skills"][0]["die"] == 10
    with pytest.raises(RulesError, match="Nenhum Progresso"):
        savage.advance(SAVAGE, "humanos", after, savage.AdvanceIn(type="new_skill", key="nadar"))
    veteran = savage.gain(after, 30)  # 40 XP: Veterano, 8 Progressos
    sheet = savage.sheet(SAVAGE, "humanos", veteran, complete=True)
    assert sheet["rank"]["name"] == "Veterano" and sheet["advances"]["available"] == 6
    with pytest.raises(RulesError, match="Faltam requisitos"):
        savage.advance(SAVAGE, "humanos", veteran, savage.AdvanceIn(type="edge", key="bloquear-aprimorado"))
    veteran, _ = savage.advance(SAVAGE, "humanos", veteran, savage.AdvanceIn(type="edge", key="bloquear"))
    veteran, _ = savage.advance(SAVAGE, "humanos", veteran, savage.AdvanceIn(type="edge", key="bloquear-aprimorado"))
    parry = next(
        d["value"] for d in savage.sheet(SAVAGE, "humanos", veteran, complete=True)["derived"] if d["key"] == "parry"
    )
    assert parry == 2 + 5 + 2
    with pytest.raises(RulesError, match="duas perícias"):
        savage.advance(SAVAGE, "humanos", veteran, savage.AdvanceIn(type="skills", keys=["lutar", "lutar"]))


def test_savage_character_flow_and_wild_roll(client, connect):
    player, master = register(client, "Bia"), register(client, "Mestre")
    draft = client.post(
        f"{API}/characters", json={"ruleset_id": "savage-worlds", "name": "Kara"}, headers=auth(player)
    ).json()
    assert draft["level_label"] == "Novato" and draft["hp_max"] == 3
    r = client.patch(f"{API}/characters/{draft['id']}", json={"ancestry_key": "anoes"}, headers=auth(player))
    assert r.json()["attributes"]["vig"] == 6
    build = {
        # Vigor d6 veio da raça: os 5 pontos vão em AGI, AST, ESP e FOR d8.
        "attributes": {"agi": 6, "ast": 6, "esp": 6, "for": 8, "vig": 6},
        "skills": [{"key": "lutar", "die": 8}, {"key": "perceber", "die": 6}, {"key": "intimidacao", "die": 6}],
        "traits": [{"key": "teimoso"}, {"key": "leal"}, {"key": "brigao"}],
    }
    r = client.patch(f"{API}/characters/{draft['id']}", json={"build": build}, headers=auth(player))
    assert r.status_code == 200, r.text
    assert r.json()["sheet"]["creation"]["hindrances"] == {"points": 2, "spent": 2, "majors": 0, "minors": 2}
    done = client.post(f"{API}/characters/{draft['id']}/finalize", headers=auth(player))
    assert done.status_code == 200, done.text
    # Pronta: perícias só mudam por Progresso; Benes e Fadiga mudam à vontade.
    r = client.patch(
        f"{API}/characters/{draft['id']}",
        json={"build": {"skills": [{"key": "lutar", "die": 12}]}},
        headers=auth(player),
    )
    assert r.status_code == 422
    r = client.patch(f"{API}/characters/{draft['id']}", json={"build": {"bennies": 1}}, headers=auth(player))
    assert r.status_code == 200
    assert next(d for d in r.json()["sheet"]["derived"] if d["key"] == "bennies")["current"] == 1

    room = client.post(
        f"{API}/rooms", json={"name": "Deadlands", "ruleset_id": "savage-worlds"}, headers=auth(master)
    ).json()
    client.post(f"{API}/rooms/join", json={"pin": room["pin"], "character_id": draft["id"]}, headers=auth(player))
    master_ws, _ = connect(room["pin"], master)
    player_ws, _ = connect(room["pin"], player)
    lutar = next(c for c in done.json()["sheet"]["checks"] if c["key"] == "lutar")
    assert lutar["notation"] == "1d8!" and lutar["wild"]
    player_ws.send_text(
        json.dumps(
            {
                "type": "roll.request",
                "id": "s1",
                **{k: lutar[k] for k in ("notation", "wild")},
                "label": "Lutar",
                "character_id": draft["id"],
            }
        )
    )
    result = receive_until(master_ws, "roll.result")
    assert result["check"]["kind"] == "savage" and result["check"]["target"] == 4
    assert [t.get("wild", False) for t in result["roll"]["terms"]] == [False, True]
    assert result["summary"].startswith("Kara rolou 1d8! + selvagem 1d6! (Lutar) = ")

    r = client.post(
        f"{API}/rooms/{room['id']}/characters/{draft['id']}/level-up", json={"experience": 5}, headers=auth(master)
    )
    assert r.status_code == 200, r.text
    assert receive_until(player_ws, "character.leveled")["summary"] == "Kara ganhou 5 XP (Novato, 1 Progresso novo)"
    r = client.post(
        f"{API}/characters/{draft['id']}/advance", json={"type": "new_skill", "key": "nadar"}, headers=auth(player)
    )
    assert r.status_code == 200, r.text
    assert {"key": "nadar", "die": 4, "note": ""} in r.json()["build"]["skills"]
    assert receive_until(player_ws, "character.leveled")["summary"] == "Kara fez um Progresso: nova perícia Nadar d4"


def test_sheet_survives_items_removed_from_pack():
    stale = gurps_build(
        traits=[{"key": "vantagem-que-sumiu"}, {"key": "ambidestria"}], skills=[{"key": "sumiu", "points": 2}]
    )
    sheet = gurps.sheet(GURPS, stale)
    assert [t["key"] for t in sheet["traits"]] == ["ambidestria"] and sheet["skills"] == []
    old = sw_build(
        traits=[{"key": "vantagem-velha", "source": "creation"}],
        skills=[{"key": "pilotar-dragao", "die": 6, "note": ""}],
    )
    assert savage.sheet(SAVAGE, "humanos", old, complete=True)["traits"] == []


def test_quick_characters_for_engines(client):
    user = register(client)
    for ruleset in ("gurps-4e", "savage-worlds"):
        r = client.post(f"{API}/characters/quick", json={"ruleset_id": ruleset, "name": "Rápido"}, headers=auth(user))
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "complete" and body["sheet"]["checks"]
    r = client.post(
        f"{API}/dice/roll", json={"notation": "3d6", "ruleset_id": "gurps-4e", "target": 10}, headers=auth(user)
    )
    assert r.status_code == 200 and r.json()["check"]["kind"] == "gurps"
    r = client.post(
        f"{API}/dice/roll", json={"notation": "1d6!", "ruleset_id": "savage-worlds", "wild": True}, headers=auth(user)
    )
    assert r.status_code == 200 and r.json()["check"]["wild"]
