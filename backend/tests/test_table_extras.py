"""Mesa 0.3: várias imagens por cena, objetos que carregam bonecos, névoa de guerra, mapa-múndi e nível."""

import base64
import io
import json
import math

from PIL import Image

from tests.conftest import (
    auth,
    drain_until_pong,
    png_bytes,
    quick_character,
    receive_until,
    receive_where,
    register,
)

API = "/api/v1"


def rgba_png(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    image.paste((120, 80, 30, 255), (width // 4, height // 4, width * 3 // 4, height * 3 // 4))
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def upload(client, room_id: str, user: dict, kind: str, data: bytes, rotation: float = 0) -> dict:
    r = client.post(
        f"{API}/rooms/{room_id}/images?kind={kind}&rotation={rotation}",
        files={"file": ("imagem.png", data, "image/png")},
        headers=auth(user),
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------- várias imagens na mesma cena ----------


def test_scene_pieces_many_images_rotation_and_cleanup(client, table, connect):
    room_id, pin = table["room"]["id"], table["room"]["pin"]
    master_h, floresta = auth(table["master"]), table["scenes"]["floresta"]
    _, _ = connect(pin, table["master"])
    ana, _ = connect(pin, table["ana"])
    beto, _ = connect(pin, table["beto"])

    # Peça com fundo transparente continua PNG; girada 90° na hora do envio troca largura e altura.
    tree = upload(client, room_id, table["master"], "piece", rgba_png(300, 100), rotation=90)
    assert tree["key"].endswith(".png") and (tree["width"], tree["height"]) == (100, 300)
    photo = upload(client, room_id, table["master"], "piece", png_bytes(300, 100), rotation=30)
    assert photo["key"].endswith(".png") and photo["width"] > 300  # cantos transparentes ao girar

    pieces = []
    for i in range(3):
        body = {"image_key": tree["key"], "x": 200 + 50 * i, "y": 200, "width": 100, "height": 300, "rotation": 15 * i}
        r = client.post(f"{API}/scenes/{floresta['id']}/images", json=body, headers=master_h)
        assert r.status_code == 201, r.text
        pieces.append(r.json())
    assert [p["z"] for p in pieces] == [0, 1, 2] and pieces[2]["rotation"] == 30
    assert receive_until(ana, "image.upserted")["image"]["id"] == pieces[0]["id"]
    assert all(m["type"] != "image.upserted" for m in drain_until_pong(beto))  # Beto está na Caverna

    # Seleção múltipla: move e gira as três de uma vez.
    items = [{"id": p["id"], "x": p["x"] + 10, "rotation": 45} for p in pieces]
    r = client.patch(f"{API}/scene-images", json={"items": items}, headers=master_h)
    assert r.status_code == 200 and all(p["rotation"] == 45 for p in r.json())
    view = client.get(f"{API}/rooms/{room_id}/table", headers=auth(table["ana"])).json()
    assert [(i["x"], i["rotation"]) for i in view["images"]] == [(210, 45), (260, 45), (310, 45)]
    locked = client.patch(f"{API}/scene-images/{pieces[0]['id']}", json={"locked": True, "z": 9}, headers=master_h)
    assert locked.json()["locked"] is True and locked.json()["z"] == 9

    # Só o Mestre mexe; imagem de outra mesa é recusada.
    assert (
        client.patch(f"{API}/scene-images/{pieces[0]['id']}", json={"x": 1}, headers=auth(table["ana"])).status_code
        == 403
    )
    other = client.post(f"{API}/rooms", json={"name": "Outra", "ruleset_id": "srd-5.1"}, headers=master_h).json()
    stolen = {"image_key": tree["key"], "x": 1, "y": 1, "width": 10, "height": 10}
    other_scene = client.post(f"{API}/rooms/{other['id']}/scenes", json={"name": "X"}, headers=master_h).json()
    assert client.post(f"{API}/scenes/{other_scene['id']}/images", json=stolen, headers=master_h).status_code == 422

    # O arquivo só é apagado quando a última peça que usa a imagem sai.
    for piece in pieces[:2]:
        assert client.delete(f"{API}/scene-images/{piece['id']}", headers=master_h).status_code == 204
    assert client.get(tree["url"]).status_code == 200
    assert client.delete(f"{API}/scene-images/{pieces[2]['id']}", headers=master_h).status_code == 204
    assert client.get(tree["url"]).status_code == 404
    assert receive_until(ana, "image.deleted")["image_id"] == pieces[0]["id"]


def test_rotation_on_every_upload(client, table):
    room_id = table["room"]["id"]
    world = upload(client, room_id, table["master"], "map", png_bytes(400, 200), rotation=90)
    assert (world["width"], world["height"]) == (200, 400)
    emblem = upload(client, room_id, table["master"], "emblem", rgba_png(64, 64), rotation=-45)
    assert emblem["key"].endswith(".png")
    enemy = upload(client, room_id, table["master"], "token", png_bytes(300, 200), rotation=12.5)
    assert (enemy["width"], enemy["height"]) == (512, 512)
    portrait = client.post(
        f"{API}/uploads/portrait?rotation=270",
        files={"file": ("eu.png", png_bytes(200, 100), "image/png")},
        headers=auth(table["ana"]),
    )
    assert portrait.status_code == 201
    token = client.patch(
        f"{API}/tokens/{table['tokens']['gob1']['id']}", json={"rotation": 90}, headers=auth(table["master"])
    )
    assert token.json()["rotation"] == 90


# ---------- objetos que carregam bonecos ----------


def test_objects_carry_tokens_and_hide_occupants(client, table, connect):
    pin, master_h = table["room"]["pin"], auth(table["master"])
    floresta, caverna = table["scenes"]["floresta"]["id"], table["scenes"]["caverna"]["id"]
    ana_t, beto_t, gob1 = (table["tokens"][k]["id"] for k in ("ana", "beto", "gob1"))
    client.patch(f"{API}/tokens/{beto_t}", json={"scene_id": floresta, "x": 150, "y": 110}, headers=master_h)

    body = {"name": "Carroça", "x": 500, "y": 400, "width": 210, "height": 140}
    cart = client.post(f"{API}/scenes/{floresta}/objects", json=body, headers=master_h).json()
    for token_id, x in ((ana_t, 470), (gob1, 530)):
        r = client.patch(
            f"{API}/tokens/{token_id}", json={"x": x, "y": 400, "container_id": cart["id"]}, headers=master_h
        )
        assert r.json()["container_id"] == cart["id"]
    # Objeto de outra cena não serve.
    boat = client.post(f"{API}/scenes/{caverna}/objects", json={**body, "name": "Barco"}, headers=master_h).json()
    assert (
        client.patch(f"{API}/tokens/{ana_t}", json={"container_id": boat["id"]}, headers=master_h).status_code == 422
    )

    master, _ = connect(pin, table["master"])
    ana, _ = connect(pin, table["ana"])
    beto, _ = connect(pin, table["beto"])

    # Arrastar a carroça leva quem está dentro.
    master.send_text(json.dumps({"type": "object.move", "object_id": cart["id"], "x": 700, "y": 400}))
    moved = receive_until(master, "object.upserted")
    assert moved["object"]["x"] == 700
    assert {t["token_id"]: (t["x"], t["y"]) for t in moved["tokens"]} == {ana_t: (670, 400), gob1: (730, 400)}
    assert len(receive_until(beto, "object.upserted")["tokens"]) == 2

    # Girar 180° em volta do centro: quem estava à esquerda vai para a direita.
    r = client.patch(f"{API}/scene-objects/{cart['id']}", json={"rotation": 180}, headers=master_h)
    assert r.json()["rotation"] == 180
    view = client.get(f"{API}/rooms/{table['room']['id']}/table", headers=master_h).json()
    positions = {t["id"]: (round(t["x"]), round(t["y"])) for t in view["tokens"]}
    assert positions[ana_t] == (730, 400) and positions[gob1] == (670, 400)

    # Esconder os ocupantes: Beto deixa de ver Ana e o goblin; Ana continua se vendo.
    client.patch(f"{API}/scene-objects/{cart['id']}", json={"hide_occupants": True}, headers=master_h)
    beto_view = receive_until(beto, "view.reset")["table"]
    assert {t["id"] for t in beto_view["tokens"]} == {beto_t}
    assert beto_view["objects"][0]["name"] == "Carroça" and beto_view["npcs"] == []
    ana_view = receive_until(ana, "view.reset")["table"]
    assert {t["id"] for t in ana_view["tokens"]} == {ana_t, beto_t}

    master.send_text(json.dumps({"type": "object.move", "object_id": cart["id"], "x": 600, "y": 400}))
    assert receive_until(beto, "object.upserted")["tokens"] == []
    assert [t["token_id"] for t in receive_until(ana, "object.upserted")["tokens"]] == [ana_t]

    # Ana desce da carroça: todos voltam a vê-la.
    r = client.patch(f"{API}/tokens/{ana_t}", json={"container_id": None, "x": 300, "y": 600}, headers=master_h)
    assert r.json()["container_id"] is None
    assert receive_until(beto, "token.upserted")["token"]["id"] == ana_t

    # Apagar a carroça solta o goblin no lugar, e ele aparece para os jogadores.
    assert client.delete(f"{API}/scene-objects/{cart['id']}", headers=master_h).status_code == 204
    assert gob1 in {t["id"] for t in receive_until(beto, "view.reset")["table"]["tokens"]}
    released = receive_where(master, "token.upserted", lambda m: m["token"]["id"] == gob1)["token"]
    assert released["container_id"] is None

    ana.send_text(json.dumps({"type": "object.move", "object_id": boat["id"], "x": 1, "y": 1}))
    assert receive_until(ana, "error")["code"] == "forbidden"


# ---------- névoa de guerra ----------


def explored(fog: dict, scene: dict, x: float, y: float) -> bool:
    data = base64.b64decode(fog["explored"])
    index = int(y // scene["fog_cell"]) * scene["fog_cols"] + int(x // scene["fog_cell"])
    return bool(data[index >> 3] & (1 << (index & 7)))


def test_fog_each_player_sees_only_what_they_explored(client, table, connect):
    pin, room_id, master_h = table["room"]["pin"], table["room"]["id"], auth(table["master"])
    floresta = table["scenes"]["floresta"]["id"]
    ana_c, beto_c = table["chars"]["ana"]["id"], table["chars"]["beto"]["id"]
    ana_t, gob1 = table["tokens"]["ana"]["id"], table["tokens"]["gob1"]["id"]
    client.patch(
        f"{API}/tokens/{table['tokens']['beto']['id']}",
        json={"scene_id": floresta, "x": 1000, "y": 700},
        headers=master_h,
    )
    scene = client.patch(
        f"{API}/scenes/{floresta}", json={"fog_enabled": True, "fog_radius": 2}, headers=master_h
    ).json()
    assert scene["fog_enabled"] and (scene["fog_cols"], scene["fog_rows"], scene["fog_cell"]) == (35, 23, 35)

    master, welcome_master = connect(pin, table["master"])
    ana, welcome_ana = connect(pin, table["ana"])
    beto, welcome_beto = connect(pin, table["beto"])
    ana_fog, beto_fog = welcome_ana["table"]["fog"], welcome_beto["table"]["fog"]
    assert explored(ana_fog, scene, 100, 100) and not explored(ana_fog, scene, 1000, 700)
    assert explored(beto_fog, scene, 1000, 700) and not explored(beto_fog, scene, 100, 100)
    assert {f["character_id"] for f in welcome_master["table"]["fog"] if f["scene_id"] == floresta} == {ana_c, beto_c}

    # Ana anda: o caminho inteiro fica explorado, só para ela (e para o Mestre).
    master.send_text(json.dumps({"type": "token.move", "token_id": ana_t, "x": 600, "y": 100}))
    revealed = receive_until(ana, "fog.revealed")
    assert revealed["character_id"] == ana_c and revealed["cells"]
    assert receive_until(master, "fog.revealed")["character_id"] == ana_c
    assert all(m["type"] != "fog.revealed" for m in drain_until_pong(beto))
    fog_now = client.get(f"{API}/rooms/{room_id}/table", headers=auth(table["ana"])).json()["fog"]
    assert all(explored(fog_now, scene, x, 100) for x in range(100, 601, 35))

    # Inimigo andando não explora nada.
    master.send_text(json.dumps({"type": "token.move", "token_id": gob1, "x": 1100, "y": 100}))
    receive_until(master, "token.moved")
    assert all(m["type"] != "fog.revealed" for m in drain_until_pong(master))

    # O Mestre cobre de novo só a exploração da Ana.
    r = client.post(f"{API}/scenes/{floresta}/fog/reset", json={"character_id": ana_c}, headers=master_h)
    assert r.status_code == 204
    assert receive_until(ana, "fog.reset")["character_id"] == ana_c
    assert all(m["type"] != "fog.reset" for m in drain_until_pong(beto))
    fog_now = client.get(f"{API}/rooms/{room_id}/table", headers=auth(table["ana"])).json()["fog"]
    assert set(base64.b64decode(fog_now["explored"])) == {0}

    # Mudar a grade descarta a exploração (não se encaixa mais) e reenvia a cena aos jogadores.
    client.patch(f"{API}/scenes/{floresta}", json={"grid_size": 50}, headers=master_h)
    assert receive_until(beto, "view.reset")["table"]["scene"]["fog_cell"] == 25
    assert receive_where(master, "fog.reset", lambda m: m["character_id"] is None)

    # Névoa desligada: o jogador não recebe mais dados de névoa.
    client.patch(f"{API}/scenes/{floresta}", json={"fog_enabled": False}, headers=master_h)
    assert receive_where(ana, "view.reset", lambda m: m["table"]["fog"] is None)
    assert client.post(f"{API}/scenes/{floresta}/fog/reset", json={}, headers=auth(table["ana"])).status_code == 403


# ---------- nível ----------


def level_up(client, user: dict, character_id: str, **body):
    return client.post(f"{API}/characters/{character_id}/level-up", json=body, headers=auth(user))


def test_level_up_srd_hp_by_class_and_attribute_points(client):
    user = register(client)
    hero = quick_character(client, user, "srd-5.1", class_key="fighter", ancestry_key="human")
    con_mod = math.floor((hero["attributes"]["con"] - 10) / 2)
    r = level_up(client, user, hero["id"])
    assert r.status_code == 200, r.text
    assert r.json()["level"] == 2 and r.json()["hp_max"] == hero["hp_max"] + 6 + con_mod
    assert level_up(client, user, hero["id"], hp_gain=5).status_code == 422  # PV pela classe
    assert level_up(client, user, hero["id"], attributes={"str": 2}).status_code == 422  # nível 3 não dá pontos
    assert level_up(client, user, hero["id"]).json()["level"] == 3
    # Nível 4: +2 (ou nada, para quem prefere um talento), nunca outro total.
    assert level_up(client, user, hero["id"], attributes={"str": 1}).status_code == 422
    r = level_up(client, user, hero["id"], attributes={"str": 1, "con": 1})
    assert r.json()["level"] == 4 and r.json()["attributes"]["str"] == hero["attributes"]["str"] + 1
    assert r.json()["attribute_audit"]["advancement"] == {"str": 1, "con": 1}
    # Conflito: outra pessoa subiu o nível antes.
    assert level_up(client, user, hero["id"], expected_version=1).status_code == 409
    for _ in range(3):
        assert level_up(client, user, hero["id"]).status_code == 200
    r = level_up(client, user, hero["id"], attributes={"str": 2})
    assert r.json()["level"] == 8 and r.json()["attributes"]["str"] == hero["attributes"]["str"] + 3 == 19
    for _ in range(3):
        level_up(client, user, hero["id"])
    too_strong = level_up(client, user, hero["id"], attributes={"str": 2})  # nível 12: passaria de 20
    assert too_strong.status_code == 422 and "20" in too_strong.json()["detail"]
    while (r := level_up(client, user, hero["id"])).status_code == 200:
        pass
    assert "máximo" in r.json()["detail"] and hero["id"]
    assert client.get(f"{API}/characters/{hero['id']}", headers=auth(user)).json()["level"] == 20


def test_level_up_generic_manual_hp_and_free_points(client):
    user = register(client)
    hero = quick_character(client, user, "generico")
    assert hero["ancestry_name"] == "Humano" and hero["background_name"] == "Aventureiro"
    assert level_up(client, user, hero["id"]).status_code == 422  # precisa informar os PV
    r = level_up(client, user, hero["id"], hp_gain=6, attributes={"for": 1, "vig": 2})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["level"] == 2 and body["hp_max"] == hero["hp_max"] + 6 and body["hp_current"] == body["hp_max"]
    assert body["attributes"]["vig"] == hero["attributes"]["vig"] + 2
    assert body["attribute_audit"]["level_ups"] == [{"level": 2, "attributes": {"for": 1, "vig": 2}, "hp": 6}]
    assert level_up(client, user, hero["id"], hp_gain=1, attributes={"for": 11}).status_code == 422


def test_level_up_announced_and_master_can_do_it(client, table, connect):
    pin, room_id = table["room"]["pin"], table["room"]["id"]
    ana_c = table["chars"]["ana"]["id"]
    master, _ = connect(pin, table["master"])
    ana, _ = connect(pin, table["ana"])
    r = client.post(f"{API}/rooms/{room_id}/characters/{ana_c}/level-up", json={}, headers=auth(table["master"]))
    assert r.status_code == 200 and r.json()["level"] == 2
    leveled = receive_until(ana, "character.leveled")
    assert leveled["level"] == 2 and "subiu para o nível 2" in leveled["summary"] and "PV" in leveled["summary"]
    assert (
        client.post(
            f"{API}/rooms/{room_id}/characters/{ana_c}/level-up", json={}, headers=auth(table["ana"])
        ).status_code
        == 403
    )
    assert level_up(client, table["ana"], ana_c).json()["level"] == 3
    assert receive_where(master, "character.leveled", lambda m: m["level"] == 3)
    events = client.get(f"{API}/rooms/{room_id}/events", headers=auth(table["master"])).json()
    assert sum(e["type"] == "level_up" for e in events) == 2
    party = client.get(f"{API}/rooms/{room_id}/table", headers=auth(table["beto"])).json()["party"]
    assert {p["id"]: p["level"] for p in party}[ana_c] == 3


# ---------- mapa-múndi, nações e facções ----------


def test_world_map_nations_and_factions(client, table, connect):
    pin, room_id, master_h = table["room"]["pin"], table["room"]["id"], auth(table["master"])
    master, welcome = connect(pin, table["master"])
    ana, welcome_ana = connect(pin, table["ana"])
    assert welcome["table"]["world"]["factions"] == [] and welcome_ana["table"]["world"]["map_url"] is None

    image = upload(client, room_id, table["master"], "map", png_bytes(800, 500))
    world = client.patch(
        f"{API}/rooms/{room_id}/world",
        json={"map_key": image["key"], "map_width": image["width"], "map_height": image["height"]},
        headers=master_h,
    ).json()
    assert world["map_url"] and world["visible"] is False
    assert receive_until(ana, "world.updated")["world"]["map_url"] is None  # ainda escondido

    def create(**body):
        r = client.post(f"{API}/rooms/{room_id}/factions", json=body, headers=master_h)
        assert r.status_code == 201, r.text
        return r.json()

    empire = create(
        kind="nation", name="Império", leader="Imperatriz Liria", secret_notes="Planeja a guerra", revealed=True
    )
    guild = create(kind="faction", name="Guilda das Sombras", parent_id=empire["id"], color="#333333")
    rebels = create(kind="faction", name="Rebeldes", seat="Floresta", revealed=True)
    bad = client.post(
        f"{API}/rooms/{room_id}/factions",
        json={"kind": "faction", "name": "X", "parent_id": guild["id"]},
        headers=master_h,
    )
    assert bad.status_code == 422  # facção só pertence a nação

    relate = f"{API}/rooms/{room_id}/relations"
    client.put(
        relate, json={"a_id": empire["id"], "b_id": rebels["id"], "kind": "war", "revealed": True}, headers=master_h
    )
    client.put(
        relate,
        json={"a_id": guild["id"], "b_id": empire["id"], "kind": "alliance", "revealed": True},
        headers=master_h,
    )
    updated = client.put(
        relate, json={"a_id": rebels["id"], "b_id": empire["id"], "kind": "tense", "revealed": True}, headers=master_h
    ).json()
    assert updated["kind"] == "tense" and updated["version"] == 2
    assert (
        client.put(
            relate, json={"a_id": empire["id"], "b_id": empire["id"], "kind": "war"}, headers=master_h
        ).status_code
        == 422
    )

    master_world = client.get(f"{API}/rooms/{room_id}/world", headers=master_h).json()
    assert [f["name"] for f in master_world["factions"]] == ["Império", "Guilda das Sombras", "Rebeldes"]
    assert len(master_world["relations"]) == 2

    # Jogadores: só o revelado, sem notas secretas; a aliança com a guilda (secreta) não aparece.
    player_world = client.get(f"{API}/rooms/{room_id}/world", headers=auth(table["ana"])).json()
    assert [f["name"] for f in player_world["factions"]] == ["Império", "Rebeldes"]
    assert all("secret_notes" not in f for f in player_world["factions"])
    assert [(r["kind"], r["note"]) for r in player_world["relations"]] == [("tense", "")]
    assert player_world["map_url"] is None

    client.patch(f"{API}/rooms/{room_id}/world", json={"visible": True}, headers=master_h)
    world_msg = receive_where(ana, "world.updated", lambda m: m["world"]["map_url"] is not None)["world"]
    assert len(world_msg["factions"]) == 2

    # Revelar a guilda mostra a nação-mãe e a aliança.
    client.patch(f"{API}/factions/{guild['id']}", json={"revealed": True}, headers=master_h)
    player_world = client.get(f"{API}/rooms/{room_id}/world", headers=auth(table["ana"])).json()
    guild_public = next(f for f in player_world["factions"] if f["name"] == "Guilda das Sombras")
    assert guild_public["parent_id"] == empire["id"] and len(player_world["relations"]) == 2

    assert (
        client.post(
            f"{API}/rooms/{room_id}/factions", json={"kind": "nation", "name": "Y"}, headers=auth(table["ana"])
        ).status_code
        == 403
    )
    # Apagar a nação solta a guilda e apaga as relações dela.
    assert client.delete(f"{API}/factions/{empire['id']}", headers=master_h).status_code == 204
    master_world = client.get(f"{API}/rooms/{room_id}/world", headers=master_h).json()
    assert [f["parent_id"] for f in master_world["factions"]] == [None, None] and master_world["relations"] == []
    assert receive_until(master, "world.updated")["world"]["map_url"]
