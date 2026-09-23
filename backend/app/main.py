import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.deps import AppState, Limiters
from app.api.v1 import api_router
from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.core.rate_limit import RateLimiter
from app.db.session import Database
from app.rulesets.loader import get_registry, sync_rulesets
from app.services.character_rules import RulesError
from app.services.media import build_media_store
from app.ws.broadcaster import Broadcaster, InMemoryBroadcaster, RedisBroadcaster
from app.ws.manager import ConnectionManager
from app.ws.router import router as ws_router

logger = logging.getLogger("rpgplay")


def _build_broadcaster(settings: Settings) -> Broadcaster:
    manager = ConnectionManager()
    if settings.redis_url:
        return RedisBroadcaster(manager, settings.redis_url)
    return InMemoryBroadcaster(manager)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Factory do app: `uvicorn app.main:create_app --factory`."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings.database_url)
        if settings.db_auto_create:
            await db.create_all()
        registry = get_registry()
        async with db.sessionmaker() as session:
            await sync_rulesets(session, registry)
        broadcaster = _build_broadcaster(settings)
        await broadcaster.start()
        app.state.ctx = AppState(
            settings=settings,
            db=db,
            registry=registry,
            media=build_media_store(settings),
            broadcaster=broadcaster,
            limiters=Limiters(
                login=RateLimiter(10, 60),
                join_pin=RateLimiter(10, 60),
                roll=RateLimiter(20, 10),
                hp=RateLimiter(30, 10),
                upload=RateLimiter(10, 60),
            ),
        )
        logger.info("RPG Play API pronta (%s pacotes de regras)", len(registry.packs))
        try:
            yield
        finally:
            await broadcaster.stop()
            await db.dispose()

    app = FastAPI(
        title="RPG Play API",
        version="0.1.0",
        lifespan=lifespan,
        # Documentação interativa só fora de produção.
        docs_url=None if settings.env == "prod" else "/docs",
        redoc_url=None,
        openapi_url=None if settings.env == "prod" else "/openapi.json",
    )

    @app.exception_handler(DomainError)
    async def _domain_error(_: Request, exc: DomainError):
        return JSONResponse(status_code=exc.status, content={"detail": exc.message, "code": exc.code})

    @app.exception_handler(RulesError)
    async def _rules_error(_: Request, exc: RulesError):
        return JSONResponse(status_code=422, content={"detail": str(exc), "code": "invalid"})

    @app.get("/health", tags=["infra"])
    async def health():
        return {"status": "ok"}

    app.include_router(api_router)
    app.include_router(ws_router)

    if settings.media_backend == "local":
        media_dir = Path(settings.media_local_dir)
        media_dir.mkdir(parents=True, exist_ok=True)
        app.mount("/media", StaticFiles(directory=media_dir), name="media")

    return app
