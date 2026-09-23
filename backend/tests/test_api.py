import io

from PIL import Image

from tests.conftest import auth, quick_character, register

API = "/api/v1"


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_register_login_refresh_logout(client):
    user = register(client, "Aria", "aria")
    me = client.get(f"{API}/me", headers=auth(user)).json()
    assert me["display_name"] == "Aria" and me["username"] == "aria"

    dup = client.post(
        f"{API}/auth/register", json={"username": "ARIA", "password": "outra-senha", "display_name": "Outra"}
    )
    assert dup.status_code == 409

    assert client.post(f"{API}/auth/login", json={"username": "aria", "password": "errada"}).status_code == 401
    login = client.post(f"{API}/auth/login", json={"username": " Aria ", "password": "senha-secreta"})
    assert login.status_code == 200

    refreshed = client.post(f"{API}/auth/refresh", json={"refresh_token": user["refresh"]})
    assert refreshed.status_code == 200
    # Refresh token é de uso único (rotação).
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": user["refresh"]}).status_code == 401

    new_refresh = refreshed.json()["refresh_token"]
    assert client.post(f"{API}/auth/logout", json={"refresh_token": new_refresh}).status_code == 204
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": new_refresh}).status_code == 401


def test_username_rules(client):
    for bad in ("ab", "com espaço", "ação", "x" * 33):
        r = client.post(
            f"{API}/auth/register", json={"username": bad, "password": "senha-secreta", "display_name": "X"}
        )
        assert r.status_code == 422, bad


def test_first_user_is_admin_and_can_reset_passwords(client):
    owner = register(client, "Dono", "dono")
    player = register(client, "Jogador", "jogador")
    assert client.get(f"{API}/me", headers=auth(owner)).json()["is_admin"] is True
    assert client.get(f"{API}/me", headers=auth(player)).json()["is_admin"] is False

    assert client.get(f"{API}/admin/users", headers=auth(player)).status_code == 403
    users = client.get(f"{API}/admin/users", headers=auth(owner)).json()
    assert [u["username"] for u in users] == ["dono", "jogador"]

    r = client.post(f"{API}/admin/users/jogador/password", json={"new_password": "nova-senha-1"}, headers=auth(owner))
    assert r.status_code == 204
    # Sessões antigas caem e a senha nova funciona.
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": player["refresh"]}).status_code == 401
    assert (
        client.post(f"{API}/auth/login", json={"username": "jogador", "password": "nova-senha-1"}).status_code == 200
    )


def test_change_own_password(client):
    user = register(client, "Bia", "bia")
    wrong = client.post(
        f"{API}/auth/password", json={"current_password": "x", "new_password": "outra-senha"}, headers=auth(user)
    )
    assert wrong.status_code == 403
    ok = client.post(
        f"{API}/auth/password",
        json={"current_password": "senha-secreta", "new_password": "outra-senha"},
        headers=auth(user),
    )
    assert ok.status_code == 204
    assert client.post(f"{API}/auth/login", json={"username": "bia", "password": "outra-senha"}).status_code == 200


def test_registration_can_be_closed_after_owner(settings):
    from fastapi.testclient import TestClient

    from app.main import create_app

    closed = settings.model_copy(update={"allow_registration": False})
    with TestClient(create_app(closed)) as c:
        register(c, "Dono", "dono")  # o primeiro cadastro sempre passa (dono do servidor)
        r = c.post(
            f"{API}/auth/register", json={"username": "outro", "password": "senha-secreta", "display_name": "Outro"}
        )
        assert r.status_code == 403
        assert c.get(f"{API}/discovery").json()["registration_open"] is False


def test_requires_auth(client):
    assert client.get(f"{API}/characters").status_code == 401
    assert client.get(f"{API}/characters", headers={"Authorization": "Bearer lixo"}).status_code == 401


def test_rulesets_catalog_for_master(client):
    rulesets = client.get(f"{API}/rulesets").json()
    statuses = [r["status"] for r in rulesets]
    assert statuses == sorted(statuses, key=["available", "planned", "restricted"].index)
    ids = {r["id"] for r in rulesets}
    assert {"srd-5.1", "srd-5.2", "generico", "old-dragon-2", "daggerheart"} <= ids
    pack = client.get(f"{API}/rulesets/srd-5.1").json()
    assert len(pack["classes"]) == 12 and len(pack["ancestries"]) == 9


def test_wizard_flow_srd52(client):
    user = register(client)
    h = auth(user)
    draft = client.post(f"{API}/characters", json={"ruleset_id": "srd-5.2"}, headers=h).json()
    cid = draft["id"]
    assert draft["status"] == "draft"
    assert set(draft["missing"]) >= {"name", "ancestry", "class", "attributes", "background"}

    steps = [
        {"name": "Thorin", "wizard_step": 1},
        {"ancestry_key": "human", "wizard_step": 2},
        {"class_key": "fighter", "wizard_step": 3},
    ]
    for patch in steps:
        r = client.patch(f"{API}/characters/{cid}", json=patch, headers=h)
        assert r.status_code == 200, r.text
    assert r.json()["class_name"] == "Guerreiro"

    r = client.post(f"{API}/characters/{cid}/attributes", json={"method": "class_preset"}, headers=h)
    assert r.json()["attributes"] == {"str": 15, "con": 14, "dex": 13, "wis": 12, "cha": 10, "int": 8}

    bad = client.patch(
        f"{API}/characters/{cid}",
        json={"background_key": "soldier", "background_bonus": {"int": 2, "con": 1}},
        headers=h,
    )
    assert bad.status_code == 422

    r = client.patch(
        f"{API}/characters/{cid}",
        json={"background_key": "soldier", "background_bonus": {"str": 2, "con": 1}, "wizard_step": 5},
        headers=h,
    )
    assert r.json()["attributes"]["str"] == 17 and r.json()["attributes"]["con"] == 15
    assert r.json()["missing"] == []

    final = client.post(f"{API}/characters/{cid}/finalize", headers=h).json()
    assert final["status"] == "complete"
    assert final["hp_max"] == 12 and final["hp_current"] == 12  # d10 + CON(+2)
    assert final["modifiers"]["str"] == 3
    assert final["load"] == {"total_weight": 0.0, "capacity": 255.0, "unit": "lb", "encumbered": False, "ratio": 0.0}


def test_finalize_reports_missing_fields(client):
    user = register(client)
    cid = client.post(f"{API}/characters", json={"ruleset_id": "srd-5.1"}, headers=auth(user)).json()["id"]
    r = client.post(f"{API}/characters/{cid}/finalize", headers=auth(user))
    assert r.status_code == 422 and "attributes" in r.json()["detail"]


def test_unavailable_ruleset_rejected(client):
    user = register(client)
    r = client.post(f"{API}/characters", json={"ruleset_id": "old-dragon-2"}, headers=auth(user))
    assert r.status_code == 422


def test_custom_options_in_generic_ruleset(client):
    user = register(client)
    h = auth(user)
    cid = client.post(f"{API}/characters", json={"ruleset_id": "generico", "name": "Zé"}, headers=h).json()["id"]
    r = client.patch(
        f"{API}/characters/{cid}",
        json={"ancestry_key": "custom", "ancestry_name": "Androide", "class_key": "explorador"},
        headers=h,
    )
    assert r.json()["ancestry_name"] == "Androide"
    client.post(f"{API}/characters/{cid}/attributes", json={"method": "roll"}, headers=h)
    final = client.post(f"{API}/characters/{cid}/finalize", headers=h).json()
    assert final["status"] == "complete" and final["hp_max"] == 10
    assert len(final["attribute_audit"]["rolls"]) == 6
    assert client.patch(f"{API}/characters/{cid}", json={"hp_max": 25}, headers=h).json()["hp_max"] == 25
    # Na 5ª edição o PV máximo é calculado, não editável.
    other = quick_character(client, user)
    assert client.patch(f"{API}/characters/{other['id']}", json={"hp_max": 99}, headers=h).status_code == 422


def test_quick_create_is_playable(client):
    user = register(client)
    for ruleset in ("srd-5.1", "srd-5.2", "generico"):
        character = quick_character(client, user, ruleset)
        assert character["status"] == "complete"
        assert character["hp_current"] == character["hp_max"] > 0
        assert len(character["attributes"]) == 6


def test_hp_changes_and_version_conflict(client):
    user = register(client)
    h = auth(user)
    c = quick_character(client, user, class_key="fighter", ancestry_key="human")
    url = f"{API}/characters/{c['id']}/hp"
    hp_max = c["hp_max"]

    temp = client.post(url, json={"delta": 5, "kind": "temp"}, headers=h).json()
    assert temp["hp_temp"] == 5 and temp["effect"] == "shield_up"
    hit = client.post(url, json={"delta": 8, "kind": "damage"}, headers=h).json()
    assert hit["absorbed_by_temp"] == 5 and hit["hp_current"] == hp_max - 3 and hit["effect"] == "bleed"
    shield_only = client.post(url, json={"delta": 1, "kind": "temp"}, headers=h).json()
    assert shield_only["hp_temp"] == 1
    assert client.post(url, json={"delta": 1, "kind": "damage"}, headers=h).json()["effect"] == "shield_hit"
    heal = client.post(url, json={"delta": 100, "kind": "heal"}, headers=h).json()
    assert heal["hp_current"] == hp_max and heal["effect"] == "heal_glow"

    stale = client.post(url, json={"delta": 1, "kind": "damage", "expected_version": 1}, headers=h)
    assert stale.status_code == 409
    ok = client.post(url, json={"delta": 999, "kind": "damage", "expected_version": heal["version"]}, headers=h)
    assert ok.json()["hp_current"] == 0


def test_inventory_load_abilities_and_rest(client):
    user = register(client)
    h = auth(user)
    c = quick_character(client, user, class_key="wizard", ancestry_key="human")
    cid = c["id"]
    r = client.post(
        f"{API}/characters/{cid}/items", json={"name": "Grimório", "weight_each": "3", "quantity": 2}, headers=h
    )
    assert r.status_code == 201
    load = r.json()["load"]
    assert load["total_weight"] == 6.0 and load["unit"] == "lb" and load["capacity"] == 9 * 15

    item_id = r.json()["items"][0]["id"]
    r = client.patch(f"{API}/characters/{cid}/items/{item_id}", json={"quantity": 100}, headers=h)
    assert r.json()["load"]["encumbered"] is True
    assert client.delete(f"{API}/characters/{cid}/items/{item_id}", headers=h).json()["items"] == []

    r = client.post(
        f"{API}/characters/{cid}/abilities", json={"name": "Recuperação Arcana", "recharge": "long_rest"}, headers=h
    )
    ability_id = r.json()["abilities"][0]["id"]
    used = client.post(f"{API}/characters/{cid}/abilities/{ability_id}/use", headers=h).json()
    assert used["abilities"][0]["available"] is False
    assert client.post(f"{API}/characters/{cid}/abilities/{ability_id}/use", headers=h).status_code == 409

    assert c["spell_slots"] == {"1": {"max": 2, "used": 0}}
    client.post(f"{API}/characters/{cid}/spell-slots/1/use", headers=h)
    r = client.post(f"{API}/characters/{cid}/spell-slots/1/use", headers=h)
    assert r.json()["spell_slots"]["1"]["used"] == 2
    assert client.post(f"{API}/characters/{cid}/spell-slots/1/use", headers=h).status_code == 409

    client.post(f"{API}/characters/{cid}/hp", json={"delta": 3, "kind": "damage"}, headers=h)
    short = client.post(f"{API}/characters/{cid}/rest", json={"type": "short"}, headers=h).json()
    assert short["abilities"][0]["available"] is False  # descanso curto não recarrega habilidade de descanso longo
    long = client.post(f"{API}/characters/{cid}/rest", json={"type": "long"}, headers=h).json()
    assert long["abilities"][0]["available"] is True
    assert long["spell_slots"]["1"]["used"] == 0 and long["hp_current"] == long["hp_max"]


def test_characters_are_private(client):
    owner, other = register(client, "Dona"), register(client, "Outro")
    c = quick_character(client, owner)
    assert client.get(f"{API}/characters/{c['id']}", headers=auth(other)).status_code == 404
    assert (
        client.post(
            f"{API}/characters/{c['id']}/hp", json={"delta": 1, "kind": "damage"}, headers=auth(other)
        ).status_code
        == 404
    )


def test_solo_dice_roll(client):
    user = register(client)
    r = client.post(f"{API}/dice/roll", json={"notation": "2d20kh1+5", "ruleset_id": "srd-5.1"}, headers=auth(user))
    body = r.json()
    assert r.status_code == 200 and body["roll"]["notation"] == "2d20kh1+5"
    assert body["outcome"]["tier"] in {"critical_failure", "low", "neutral", "high", "critical_success"}
    assert "animation" in body["outcome"]["effect"]
    assert client.post(f"{API}/dice/roll", json={"notation": "1d7"}, headers=auth(user)).status_code == 422


def test_portrait_upload_strips_metadata(client, settings):
    user = register(client)
    image = Image.new("RGB", (800, 600), (200, 30, 30))
    exif = Image.Exif()
    exif[0x010F] = "CameraDoJogador"  # Make
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif.tobytes())
    r = client.post(
        f"{API}/uploads/portrait",
        files={"file": ("foto.jpg", buffer.getvalue(), "image/jpeg")},
        headers=auth(user),
    )
    assert r.status_code == 201, r.text
    stored = settings.media_path / r.json()["portrait_key"]
    with Image.open(stored) as saved:
        assert saved.size == (512, 512)
        assert not saved.getexif()
    assert client.get(r.json()["url"]).status_code == 200

    bad = client.post(
        f"{API}/uploads/portrait", files={"file": ("x.jpg", b"nao-e-imagem", "image/jpeg")}, headers=auth(user)
    )
    assert bad.status_code == 422


def test_export_and_delete_account(client):
    user = register(client, "Saida", "saida")
    h = auth(user)
    quick_character(client, user)
    export = client.get(f"{API}/me/export", headers=h).json()
    assert export["user"]["username"] == "saida" and len(export["characters"]) == 1

    assert client.delete(f"{API}/me", headers=h).status_code == 204
    assert client.get(f"{API}/me", headers=h).status_code == 401
    login = client.post(f"{API}/auth/login", json={"username": "saida", "password": "senha-secreta"})
    assert login.status_code == 401
    # O nome de usuário fica livre para uma conta nova.
    register(client, "Volta", "saida")


def test_reports_and_blocks(client):
    a, b = register(client, "Alice"), register(client, "Bruno")
    b_id = client.get(f"{API}/me", headers=auth(b)).json()["id"]
    r = client.post(
        f"{API}/reports", json={"target_type": "user", "target_id": b_id, "reason": "harassment"}, headers=auth(a)
    )
    assert r.status_code == 201 and r.json()["status"] == "open"
    assert client.post(f"{API}/blocks", json={"user_id": b_id}, headers=auth(a)).status_code == 204
    assert client.get(f"{API}/blocks", headers=auth(a)).json() == [b_id]
    assert client.delete(f"{API}/blocks/{b_id}", headers=auth(a)).status_code == 204
    assert client.get(f"{API}/blocks", headers=auth(a)).json() == []
