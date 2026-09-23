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
        url = PG_URL
    else:
        url = f"sqlite+aiosqlite:///{tmp_path / 'test.db'}"
    return Settings(
        env="test",
        database_url=url,
        db_auto_create=True,
        media_local_dir=str(tmp_path / "media"),
        ws_auth_timeout_seconds=1.0,
    )


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def register(client: TestClient, name: str = "Aria", email: str | None = None) -> dict:
    email = email or f"{name.lower()}-{uuid.uuid4().hex[:6]}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "senha-super-secreta",
            "display_name": name,
            "age_confirmed": True,
            "accept_terms": True,
        },
    )
    assert response.status_code == 201, response.text
    tokens = response.json()
    return {"email": email, "token": tokens["access_token"], "refresh": tokens["refresh_token"]}


def auth(user: dict) -> dict:
    return {"Authorization": f"Bearer {user['token']}"}


def quick_character(client: TestClient, user: dict, ruleset_id: str = "srd-5.1", **extra) -> dict:
    response = client.post(
        "/api/v1/characters/quick", json={"ruleset_id": ruleset_id, "name": "Herói", **extra}, headers=auth(user)
    )
    assert response.status_code == 201, response.text
    return response.json()
