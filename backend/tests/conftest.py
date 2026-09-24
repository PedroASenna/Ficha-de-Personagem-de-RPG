"""Fixtures da API.

Por padrão os testes rodam em SQLite (rápido, sem dependências). Para rodar contra o Postgres real
(como no CI), exporte RPG_TEST_DATABASE_URL=postgresql+asyncpg://rpg:rpg@localhost:5432/rpg_test.
"""

import asyncio
import contextlib
import io
import json
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings
from app.db.base import Base
from app.main import create_app

PG_URL = os.environ.get("RPG_TEST_DATABASE_URL")


def _reset_postgres(url: str) -> None:
    async def run() -> None:
        engine = create_async_engine(url)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(run())


@pytest.fixture
def settings(tmp_path) -> Settings:
    if PG_URL:
        _reset_postgres(PG_URL)
    return Settings(
        env="test",
        data_dir=str(tmp_path / "data"),
        database_url=PG_URL,  # None = SQLite em data_dir
        db_auto_create=True,
        discovery_enabled=False,
        ws_auth_timeout_seconds=1.0,
        server_name="Mesa de Teste",
    )


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def register(
    client: TestClient, name: str = "Aria", username: str | None = None, password: str = "senha-secreta"
) -> dict:
    username = username or f"{name.lower()}_{uuid.uuid4().hex[:6]}"
    response = client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": password, "display_name": name},
    )
    assert response.status_code == 201, response.text
    tokens = response.json()
    return {"username": username, "token": tokens["access_token"], "refresh": tokens["refresh_token"]}


def auth(user: dict) -> dict:
    return {"Authorization": f"Bearer {user['token']}"}


def quick_character(client: TestClient, user: dict, ruleset_id: str = "srd-5.1", **extra) -> dict:
    response = client.post(
        "/api/v1/characters/quick", json={"ruleset_id": ruleset_id, "name": "Herói", **extra}, headers=auth(user)
    )
    assert response.status_code == 201, response.text
    return response.json()


API = "/api/v1"


# ---------- mesa virtual ----------


def png_bytes(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (30, 90, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


def receive_until(ws, msg_type: str, limit: int = 15) -> dict:
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == msg_type:
            return msg
    raise AssertionError(f"{msg_type} não chegou")


def receive_where(ws, msg_type: str, predicate, limit: int = 30) -> dict:  # noqa: ANN001
    """Próxima mensagem do tipo que satisfaz a condição (pula as anteriores do mesmo tipo)."""
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == msg_type and predicate(msg):
            return msg
    raise AssertionError(f"{msg_type} esperado não chegou")


def drain_until_pong(ws) -> list[dict]:
    """Tudo que chegou até o pong (para provar que um evento NÃO foi entregue)."""
    ws.send_text(json.dumps({"type": "ping"}))
    seen = []
    for _ in range(30):
        msg = ws.receive_json()
        if msg["type"] == "pong":
            return seen
        seen.append(msg)
    raise AssertionError("pong não chegou")


@pytest.fixture
def connect(client):
    with contextlib.ExitStack() as stack:

        def _connect(pin: str, user: dict):
            session = stack.enter_context(client.websocket_connect(f"/ws/rooms/{pin}"))
            session.send_text(json.dumps({"type": "auth", "token": user["token"]}))
            welcome = session.receive_json()
            assert welcome["type"] == "welcome", welcome
            return session, welcome

        yield _connect


@pytest.fixture
def table(client):
    """Mestre com duas cenas; Ana na Floresta, Beto na Caverna; Goblin 1 visível e Goblin 2 escondido na Floresta."""
    master, ana, beto = register(client, "Mestre"), register(client, "Ana"), register(client, "Beto")
    room = client.post(f"{API}/rooms", json={"name": "Campanha", "ruleset_id": "srd-5.1"}, headers=auth(master)).json()
    chars = {}
    for name, user in (("ana", ana), ("beto", beto)):
        chars[name] = quick_character(client, user, "srd-5.1", class_key="fighter", ancestry_key="human")
        r = client.post(
            f"{API}/rooms/join", json={"pin": room["pin"], "character_id": chars[name]["id"]}, headers=auth(user)
        )
        assert r.status_code == 200

    upload = client.post(
        f"{API}/rooms/{room['id']}/images?kind=map",
        files={"file": ("floresta.png", png_bytes(1200, 800), "image/png")},
        headers=auth(master),
    ).json()
    scenes = {}
    for name, extra in (
        ("floresta", {"map_key": upload["key"], "map_width": 1200, "map_height": 800}),
        ("caverna", {}),
    ):
        r = client.post(f"{API}/rooms/{room['id']}/scenes", json={"name": name, **extra}, headers=auth(master))
        assert r.status_code == 201, r.text
        scenes[name] = r.json()
    goblins = client.post(
        f"{API}/rooms/{room['id']}/npcs",
        json={"name": "Goblin", "hp_max": 7, "armor_class": 15, "attributes": {"str": 8, "dex": 14}, "count": 2},
        headers=auth(master),
    ).json()

    def place(**body):
        r = client.post(f"{API}/rooms/{room['id']}/tokens", json=body, headers=auth(master))
        assert r.status_code == 201, r.text
        return r.json()

    tokens = {
        "ana": place(scene_id=scenes["floresta"]["id"], character_id=chars["ana"]["id"], x=100, y=100),
        "beto": place(scene_id=scenes["caverna"]["id"], character_id=chars["beto"]["id"], x=50, y=50),
        "gob1": place(scene_id=scenes["floresta"]["id"], npc_id=goblins[0]["id"], x=300, y=200),
        "gob2": place(scene_id=scenes["floresta"]["id"], npc_id=goblins[1]["id"], x=320, y=220, hidden=True),
    }
    return {
        "room": room,
        "master": master,
        "ana": ana,
        "beto": beto,
        "chars": chars,
        "scenes": scenes,
        "goblins": goblins,
        "tokens": tokens,
    }
