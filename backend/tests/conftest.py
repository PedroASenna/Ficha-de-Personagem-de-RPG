"""Fixtures da API.

Por padrão os testes rodam em SQLite (rápido, sem dependências). Para rodar contra o Postgres real
(como no CI), exporte RPG_TEST_DATABASE_URL=postgresql+asyncpg://rpg:rpg@localhost:5432/rpg_test.
"""

import asyncio
import os
import uuid

import pytest
from fastapi.testclient import TestClient
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
