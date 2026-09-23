"""Fan-out de eventos da sala.

- InMemoryBroadcaster: uma instância só (dev, testes).
- RedisBroadcaster: várias instâncias (Cloud Run escala horizontalmente); cada instância assina
  o canal e entrega para as conexões que ela mesma mantém.
"""

import asyncio
import contextlib
import json
import logging
import uuid
from typing import Any, Protocol

from app.ws.manager import ConnectionManager

logger = logging.getLogger(__name__)
CHANNEL_PREFIX = "rpgplay:room:"


class Broadcaster(Protocol):
    manager: ConnectionManager

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    async def publish(
        self, room_id: uuid.UUID, message: dict[str, Any], audience: list[str] | None = None
    ) -> None: ...


class InMemoryBroadcaster:
    def __init__(self, manager: ConnectionManager) -> None:
        self.manager = manager

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def publish(self, room_id: uuid.UUID, message: dict[str, Any], audience: list[str] | None = None) -> None:
        await self.manager.deliver(room_id, message, audience)


class RedisBroadcaster:
    def __init__(self, manager: ConnectionManager, url: str) -> None:
        import redis.asyncio as redis

        self.manager = manager
        self._redis = redis.from_url(url, decode_responses=True)
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        pubsub = self._redis.pubsub()
        await pubsub.psubscribe(f"{CHANNEL_PREFIX}*")
        self._task = asyncio.create_task(self._listen(pubsub))

    async def _listen(self, pubsub) -> None:  # noqa: ANN001
        async for item in pubsub.listen():
            if item.get("type") != "pmessage":
                continue
            try:
                envelope = json.loads(item["data"])
                room_id = uuid.UUID(item["channel"].removeprefix(CHANNEL_PREFIX))
                await self.manager.deliver(room_id, envelope["message"], envelope.get("audience"))
            except Exception:
                logger.exception("Mensagem inválida no canal %s", item.get("channel"))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        await self._redis.aclose()

    async def publish(self, room_id: uuid.UUID, message: dict[str, Any], audience: list[str] | None = None) -> None:
        envelope = json.dumps({"message": message, "audience": audience}, default=str)
        await self._redis.publish(f"{CHANNEL_PREFIX}{room_id}", envelope)
