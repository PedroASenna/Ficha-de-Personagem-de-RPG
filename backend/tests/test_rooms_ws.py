import contextlib
import json

import pytest
from starlette.websockets import WebSocketDisconnect

from app.ws.protocol import CLOSE_FORBIDDEN, CLOSE_NOT_FOUND, CLOSE_ROOM_CLOSED, CLOSE_UNAUTHORIZED
from tests.conftest import auth, quick_character, register

API = "/api/v1"


def receive_until(ws, msg_type: str, limit: int = 10, **match) -> dict:
    """Lê mensagens até achar o tipo pedido (presence e afins podem chegar antes)."""
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == msg_type and all(msg.get(k) == v for k, v in match.items()):
            return msg
    raise AssertionError(f"mensagem {msg_type} não chegou")


@pytest.fixture
def connect(client):
    """Abre WebSockets autenticados e garante o fechamento mesmo se o teste falhar (senão o TestClient trava)."""
    with contextlib.ExitStack() as stack:

        def _connect(pin: str, user: dict):
            ctx = client.websocket_connect(f"/ws/rooms/{pin}")
            session = stack.enter_context(ctx)
            session.send_text(json.dumps({"type": "auth", "token": user["token"]}))
            welcome = session.receive_json()
            assert welcome["type"] == "welcome", welcome
            return session, welcome

        yield _connect


@pytest.fixture
def table(client):
    """Mestre com sala de SRD 5.1 e um jogador sentado com personagem."""
    master, player = register(client, "Mestre"), register(client, "Jogadora")
    room = client.post(f"{API}/rooms", json={"name": "Mina Perdida", "ruleset_id": "srd-5.1"}, headers=auth(master))
    assert room.status_code == 201, room.text
    room = room.json()
    character = quick_character(client, player, "srd-5.1", class_key="fighter", ancestry_key="human")
    joined = client.post(
        f"{API}/rooms/join", json={"pin": room["pin"].lower(), "character_id": character["id"]}, headers=auth(player)
    )
    assert joined.status_code == 200, joined.text
    return {"master": master, "player": player, "room": room, "character": character}


def test_master_must_pick_available_ruleset(client):
    master = register(client, "Mestre")
    for ruleset in ("old-dragon-2", "daggerheart", "tormenta20"):
        r = client.post(f"{API}/rooms", json={"name": "X", "ruleset_id": ruleset}, headers=auth(master))
        assert r.status_code == 422, ruleset
    r = client.post(f"{API}/rooms", json={"name": "Mesa", "ruleset_id": "srd-5.2"}, headers=auth(master))
    room = r.json()
    assert room["ruleset_name"].startswith("Fantasia 5ª Edição 2024") and room["my_role"] == "master"
    assert len(room["pin"]) == 6 and not set(room["pin"]) & set("01IO")


def test_join_rules(client, table):
    other = register(client, "Outro")
    generic = quick_character(client, other, "generico")
    pin = table["room"]["pin"]
    r = client.post(f"{API}/rooms/join", json={"pin": pin, "character_id": generic["id"]}, headers=auth(other))
    assert r.status_code == 422 and "outro sistema" in r.json()["detail"]
    assert client.post(f"{API}/rooms/join", json={"pin": "ZZZZZZ"}, headers=auth(other)).status_code == 404
    draft = client.post(f"{API}/characters", json={"ruleset_id": "srd-5.1"}, headers=auth(other)).json()
    r = client.post(f"{API}/rooms/join", json={"pin": pin, "character_id": draft["id"]}, headers=auth(other))
    assert r.status_code == 422
    room = client.post(f"{API}/rooms/join", json={"pin": pin}, headers=auth(other)).json()
    assert {m["display_name"] for m in room["members"]} == {"Mestre", "Jogadora", "Outro"}


def test_ws_rejects_bad_token_and_unknown_room(client, table):
    with client.websocket_connect(f"/ws/rooms/{table['room']['pin']}") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": "invalido"}))
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == CLOSE_UNAUTHORIZED
    with client.websocket_connect("/ws/rooms/ZZZZZZ") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": table["master"]["token"]}))
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == CLOSE_NOT_FOUND
    stranger = register(client, "Estranho")
    with client.websocket_connect(f"/ws/rooms/{table['room']['pin']}") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": stranger["token"]}))
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == CLOSE_FORBIDDEN


def test_roll_and_damage_reach_master_with_log(client, table, connect):
    pin, character = table["room"]["pin"], table["character"]
    master, welcome = connect(pin, table["master"])
    assert welcome["room"]["my_role"] == "master"
    assert welcome["log"][0]["type"] == "join"
    player, _ = connect(pin, table["player"])
    presence = receive_until(master, "presence", display_name="Jogadora")
    assert presence["online"] is True

    player.send_text(
        json.dumps(
            {
                "type": "roll.request",
                "id": "r1",
                "notation": "1d20+5",
                "character_id": character["id"],
                "label": "Ataque",
            }
        )
    )
    for ws in (player, master):
        result = receive_until(ws, "roll.result")
        assert result["request_id"] == "r1" and result["roll"]["notation"] == "1d20+5"
        natural = result["roll"]["terms"][0]["dice"][0]["value"]
        assert result["roll"]["total"] == natural + 5
        assert result["outcome"]["natural"] == natural
        expected = "critical_success" if natural == 20 else "critical_failure" if natural == 1 else None
        if expected:
            assert result["outcome"]["tier"] == expected
        assert result["summary"].startswith("Herói rolou 1d20+5 (Ataque) =")

    player.send_text(json.dumps({"type": "hp.change", "character_id": character["id"], "delta": 4, "kind": "damage"}))
    changed = receive_until(master, "hp.changed")
    assert changed["effect"] == "bleed" and changed["hp_current"] == character["hp_max"] - 4
    assert "sofreu 4 de dano" in changed["summary"]
    receive_until(player, "hp.changed")

    # O Mestre também pode aplicar dano no personagem de um jogador.
    master.send_text(json.dumps({"type": "hp.change", "character_id": character["id"], "delta": 2, "kind": "heal"}))
    healed = receive_until(player, "hp.changed")
    assert healed["effect"] == "heal_glow" and healed["hp_current"] == character["hp_max"] - 2
    receive_until(master, "hp.changed")

    events = client.get(f"{API}/rooms/{table['room']['id']}/events", headers=auth(table["master"])).json()
    assert [e["type"] for e in events] == ["join", "dice_roll", "hp_change", "hp_change"]


def test_presence_goes_offline_when_player_leaves(client, table, connect):
    pin = table["room"]["pin"]
    master, _ = connect(pin, table["master"])
    with client.websocket_connect(f"/ws/rooms/{pin}") as player:
        player.send_text(json.dumps({"type": "auth", "token": table["player"]["token"]}))
        assert player.receive_json()["type"] == "welcome"
        assert receive_until(master, "presence", display_name="Jogadora")["online"] is True
    assert receive_until(master, "presence", display_name="Jogadora")["online"] is False


def test_secret_roll_only_for_master_and_roller(client, table, connect):
    pin = table["room"]["pin"]
    third = register(client, "Terceiro")
    client.post(f"{API}/rooms/join", json={"pin": pin}, headers=auth(third))
    master, _ = connect(pin, table["master"])
    spectator, _ = connect(pin, third)
    player, _ = connect(pin, table["player"])

    player.send_text(json.dumps({"type": "roll.request", "id": "s1", "notation": "1d20", "visibility": "master_only"}))
    assert receive_until(master, "roll.result")["visibility"] == "master_only"
    assert receive_until(player, "roll.result")["request_id"] == "s1"
    spectator.send_text(json.dumps({"type": "ping"}))
    # O espectador recebe presença e o pong, mas nunca o roll.result secreto.
    msgs = [spectator.receive_json() for _ in range(2)]
    while msgs[-1]["type"] != "pong":
        msgs.append(spectator.receive_json())
    assert all(m["type"] != "roll.result" for m in msgs)

    events = client.get(f"{API}/rooms/{table['room']['id']}/events", headers=auth(third)).json()
    assert all(e["type"] != "dice_roll" for e in events)
    events = client.get(f"{API}/rooms/{table['room']['id']}/events", headers=auth(table["master"])).json()
    assert any(e["type"] == "dice_roll" for e in events)


def test_ws_errors_and_permissions(client, table, connect):
    pin = table["room"]["pin"]
    other = register(client, "Intrusa")
    client.post(f"{API}/rooms/join", json={"pin": pin}, headers=auth(other))
    ws, _ = connect(pin, other)
    ws.send_text("isso não é json")
    assert receive_until(ws, "error")["code"] == "bad_request"
    ws.send_text(json.dumps({"type": "roll.request", "id": "x", "notation": "1d7"}))
    err = receive_until(ws, "error")
    assert err["code"] == "invalid_notation" and err["ref"] == "x"
    ws.send_text(
        json.dumps({"type": "hp.change", "character_id": table["character"]["id"], "delta": 5, "kind": "damage"})
    )
    assert receive_until(ws, "error")["code"] == "forbidden"


def test_rest_api_damage_notifies_master(client, table, connect):
    pin, character = table["room"]["pin"], table["character"]
    master, _ = connect(pin, table["master"])
    r = client.post(
        f"{API}/characters/{character['id']}/hp", json={"delta": 3, "kind": "damage"}, headers=auth(table["player"])
    )
    assert r.status_code == 200
    changed = receive_until(master, "hp.changed")
    assert changed["delta"] == 3 and changed["actor"]["display_name"] == "Jogadora"


def test_kick_and_close_room(client, table, connect):
    pin, room_id = table["room"]["pin"], table["room"]["id"]
    master, _ = connect(pin, table["master"])
    player, _ = connect(pin, table["player"])
    player_id = client.get(f"{API}/me", headers=auth(table["player"])).json()["id"]

    assert (
        client.post(
            f"{API}/rooms/{room_id}/kick", json={"user_id": player_id}, headers=auth(table["player"])
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{API}/rooms/{room_id}/kick", json={"user_id": player_id}, headers=auth(table["master"])
        ).status_code
        == 204
    )
    with pytest.raises(WebSocketDisconnect) as exc:
        receive_until(player, "never")
    assert exc.value.code == CLOSE_FORBIDDEN
    assert client.post(f"{API}/rooms/join", json={"pin": pin}, headers=auth(table["player"])).status_code == 403

    assert client.post(f"{API}/rooms/{room_id}/close", headers=auth(table["master"])).status_code == 204
    with pytest.raises(WebSocketDisconnect) as exc:
        receive_until(master, "never")
    assert exc.value.code == CLOSE_ROOM_CLOSED
