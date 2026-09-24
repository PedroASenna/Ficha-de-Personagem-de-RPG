"""Mesa virtual: cenas com mapa, inimigos e bonecos; o Mestre vê tudo, cada jogador só a própria cena."""

import json

from tests.conftest import auth, drain_until_pong, png_bytes, quick_character, receive_until, register

API = "/api/v1"


def test_npcs_numbered_and_map_upload(client, table):
    assert [g["name"] for g in table["goblins"]] == ["Goblin 1", "Goblin 2"]
    assert table["goblins"][0]["hp_current"] == 7 and table["goblins"][0]["condition"] == "ileso"
    big = client.post(
        f"{API}/rooms/{table['room']['id']}/images?kind=map",
        files={"file": ("grande.png", png_bytes(5000, 3000), "image/png")},
        headers=auth(table["master"]),
    ).json()
    assert big["width"] == 4096 and big["height"] == 2458
    assert client.get(big["url"]).status_code == 200


def test_only_master_edits_the_table(client, table):
    room_id, ana = table["room"]["id"], table["ana"]
    assert client.post(f"{API}/rooms/{room_id}/scenes", json={"name": "X"}, headers=auth(ana)).status_code == 403
    assert client.post(f"{API}/rooms/{room_id}/npcs", json={"name": "X"}, headers=auth(ana)).status_code == 403
    token_body = {"scene_id": table["scenes"]["floresta"]["id"], "npc_id": table["goblins"][0]["id"], "x": 1, "y": 1}
    assert client.post(f"{API}/rooms/{room_id}/tokens", json=token_body, headers=auth(ana)).status_code == 403
    assert (
        client.patch(f"{API}/tokens/{table['tokens']['ana']['id']}", json={"x": 5}, headers=auth(ana)).status_code
        == 403
    )
    assert (
        client.post(
            f"{API}/npcs/{table['goblins'][0]['id']}/hp", json={"delta": 1, "kind": "damage"}, headers=auth(ana)
        ).status_code
        == 403
    )
    upload = client.post(
        f"{API}/rooms/{room_id}/images?kind=token",
        files={"file": ("x.png", png_bytes(10, 10), "image/png")},
        headers=auth(ana),
    )
    assert upload.status_code == 403
    sheet = client.get(f"{API}/rooms/{room_id}/characters/{table['chars']['beto']['id']}", headers=auth(ana))
    assert sheet.status_code == 403


def test_map_key_must_belong_to_the_room(client, table):
    other = client.post(
        f"{API}/rooms", json={"name": "Outra", "ruleset_id": "srd-5.1"}, headers=auth(table["master"])
    ).json()
    r = client.post(
        f"{API}/rooms/{other['id']}/scenes",
        json={"name": "Roubada", "map_key": table["scenes"]["floresta"]["map_key"]},
        headers=auth(table["master"]),
    )
    assert r.status_code == 422


def test_views_master_sees_all_player_sees_own_scene(client, table):
    room_id = table["room"]["id"]
    master_view = client.get(f"{API}/rooms/{room_id}/table", headers=auth(table["master"])).json()
    assert master_view["role"] == "master"
    assert {s["name"] for s in master_view["scenes"]} == {"floresta", "caverna"}
    assert len(master_view["tokens"]) == 4
    assert all("hp_current" in n and "attributes" in n for n in master_view["npcs"])

    ana_view = client.get(f"{API}/rooms/{room_id}/table", headers=auth(table["ana"])).json()
    assert ana_view["role"] == "player" and ana_view["scene"]["name"] == "floresta"
    assert ana_view["scene"]["map_url"]
    visible = {t["id"] for t in ana_view["tokens"]}
    assert visible == {table["tokens"]["ana"]["id"], table["tokens"]["gob1"]["id"]}  # sem o goblin escondido
    assert ana_view["npcs"] == [
        {
            "id": table["goblins"][0]["id"],
            "name": "Goblin 1",
            "portrait_url": None,
            "condition": "ileso",
            "condition_label": "Ileso",
        }
    ]
    assert {p["name"] for p in ana_view["party"]} == {"Herói"}  # o grupo aparece com PV
    assert len(ana_view["party"]) == 2

    beto_view = client.get(f"{API}/rooms/{room_id}/table", headers=auth(table["beto"])).json()
    assert beto_view["scene"]["name"] == "caverna" and beto_view["npcs"] == []

    sheet = client.get(
        f"{API}/rooms/{room_id}/characters/{table['chars']['ana']['id']}", headers=auth(table["master"])
    )
    assert sheet.status_code == 200 and sheet.json()["attributes"]["str"] == 16


def test_token_move_reaches_only_players_in_that_scene(client, table, connect):
    pin = table["room"]["pin"]
    master, welcome_master = connect(pin, table["master"])
    ana, welcome_ana = connect(pin, table["ana"])
    beto, _ = connect(pin, table["beto"])
    assert welcome_master["table"]["role"] == "master" and len(welcome_master["table"]["tokens"]) == 4
    assert welcome_ana["table"]["scene"]["name"] == "floresta"

    gob1 = table["tokens"]["gob1"]["id"]
    master.send_text(json.dumps({"type": "token.move", "token_id": gob1, "x": 410.5, "y": 222}))
    moved = receive_until(ana, "token.moved")
    assert moved["token_id"] == gob1 and moved["x"] == 410.5
    assert receive_until(master, "token.moved")["token_id"] == gob1
    assert all(m["type"] != "token.moved" for m in drain_until_pong(beto))

    # Boneco escondido se move sem ninguém além do Mestre saber.
    gob2 = table["tokens"]["gob2"]["id"]
    master.send_text(json.dumps({"type": "token.move", "token_id": gob2, "x": 1, "y": 1}))
    receive_until(master, "token.moved")
    assert all(m["type"] != "token.moved" for m in drain_until_pong(ana))

    # Jogador não move boneco (nem o próprio).
    ana.send_text(json.dumps({"type": "token.move", "token_id": table["tokens"]["ana"]["id"], "x": 0, "y": 0}))
    assert receive_until(ana, "error")["code"] == "forbidden"


def test_group_splits_and_rejoins(client, table, connect):
    pin = table["room"]["pin"]
    master, _ = connect(pin, table["master"])
    ana, _ = connect(pin, table["ana"])
    beto, _ = connect(pin, table["beto"])

    # Beto vai da Caverna para a Floresta: recebe a cena inteira; Ana vê o boneco dele chegar.
    r = client.patch(
        f"{API}/tokens/{table['tokens']['beto']['id']}",
        json={"scene_id": table["scenes"]["floresta"]["id"], "x": 150, "y": 110},
        headers=auth(table["master"]),
    )
    assert r.status_code == 200
    reset = receive_until(beto, "view.reset")
    assert reset["table"]["scene"]["name"] == "floresta"
    assert {t["id"] for t in reset["table"]["tokens"]} == {
        table["tokens"]["ana"]["id"],
        table["tokens"]["beto"]["id"],
        table["tokens"]["gob1"]["id"],
    }
    assert receive_until(ana, "token.upserted")["token"]["id"] == table["tokens"]["beto"]["id"]
    assert receive_until(master, "token.upserted")["token"]["scene_id"] == table["scenes"]["floresta"]["id"]

    # Revelar a emboscada: o goblin escondido aparece para os dois, com dados públicos.
    client.patch(
        f"{API}/tokens/{table['tokens']['gob2']['id']}", json={"hidden": False}, headers=auth(table["master"])
    )
    for ws in (ana, beto):
        shown = receive_until(ws, "token.upserted")
        assert shown["token"]["id"] == table["tokens"]["gob2"]["id"]
        assert shown["npc"]["name"] == "Goblin 2" and "hp_current" not in shown["npc"]


def test_npc_damage_numbers_only_for_master(client, table, connect):
    pin = table["room"]["pin"]
    master, _ = connect(pin, table["master"])
    ana, _ = connect(pin, table["ana"])
    beto, _ = connect(pin, table["beto"])
    gob1 = table["goblins"][0]

    master.send_text(json.dumps({"type": "hp.change", "npc_id": gob1["id"], "delta": 4, "kind": "damage"}))
    changed = receive_until(master, "npc.hp.changed")
    assert changed["hp_current"] == 3 and changed["condition"] == "muito_ferido"
    assert "Goblin 1 sofreu 4 de dano" in changed["summary"]

    public = receive_until(ana, "npc.upserted")["npc"]
    assert public == {
        "id": gob1["id"],
        "name": "Goblin 1",
        "portrait_url": None,
        "condition": "muito_ferido",
        "condition_label": "Muito ferido",
    }
    assert all(m["type"] not in ("npc.upserted", "npc.hp.changed") for m in drain_until_pong(beto))

    # O log do jogador não mostra os números do inimigo.
    events = client.get(f"{API}/rooms/{table['room']['id']}/events", headers=auth(table["ana"])).json()
    assert all("Goblin" not in (e["payload"].get("summary") or "") for e in events)

    # Jogador não mexe nos PV do inimigo.
    ana.send_text(json.dumps({"type": "hp.change", "npc_id": gob1["id"], "delta": 1, "kind": "damage"}))
    assert receive_until(ana, "error")["code"] == "forbidden"


def test_master_rolls_for_npc_in_secret(client, table, connect):
    pin = table["room"]["pin"]
    master, _ = connect(pin, table["master"])
    ana, _ = connect(pin, table["ana"])
    master.send_text(
        json.dumps(
            {
                "type": "roll.request",
                "id": "atk",
                "notation": "1d20+4",
                "npc_id": table["goblins"][0]["id"],
                "label": "Cimitarra",
                "visibility": "master_only",
            }
        )
    )
    result = receive_until(master, "roll.result")
    assert result["npc"]["name"] == "Goblin 1" and result["summary"].startswith("Goblin 1 rolou 1d20+4 (Cimitarra)")
    assert all(m["type"] != "roll.result" for m in drain_until_pong(ana))


def test_deleting_scene_and_character_token_resets_player_view(client, table, connect):
    pin = table["room"]["pin"]
    _, _ = connect(pin, table["master"])
    beto, _ = connect(pin, table["beto"])
    r = client.delete(f"{API}/scenes/{table['scenes']['caverna']['id']}", headers=auth(table["master"]))
    assert r.status_code == 204
    assert receive_until(beto, "view.reset")["table"]["scene"] is None
    view = client.get(f"{API}/rooms/{table['room']['id']}/table", headers=auth(table["master"])).json()
    assert {s["name"] for s in view["scenes"]} == {"floresta"}
    assert table["tokens"]["beto"]["id"] not in {t["id"] for t in view["tokens"]}


def test_master_sees_party_update_when_player_joins(client, table, connect):
    master, welcome = connect(table["room"]["pin"], table["master"])
    assert len(welcome["table"]["party"]) == 2
    carla = register(client, "Carla")
    char = quick_character(client, carla, "srd-5.1", class_key="fighter", ancestry_key="human")
    r = client.post(
        f"{API}/rooms/join", json={"pin": table["room"]["pin"], "character_id": char["id"]}, headers=auth(carla)
    )
    assert r.status_code == 200
    party = receive_until(master, "party.updated")["party"]
    assert sorted(p["name"] for p in party) == sorted(
        [table["chars"]["ana"]["name"], table["chars"]["beto"]["name"], char["name"]]
    )
