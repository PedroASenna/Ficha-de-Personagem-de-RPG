import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.deps import AppState, Limiters
from app.api.v1 import api_router
from app.core.config import Settings, ensure_runtime_secrets, get_settings, server_id
from app.core.discovery import start_discovery
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


def _mount_master_panel(app: FastAPI, dist: Path) -> None:
    """Painel web do Mestre (SPA) em /mestre, com fallback para index.html nas rotas do cliente."""
    index = dist / "index.html"

    @app.get("/", include_in_schema=False)
    async def root():
        return RedirectResponse("/mestre/")

    @app.get("/mestre", include_in_schema=False)
    @app.get("/mestre/{path:path}", include_in_schema=False)
    async def master_panel(path: str = ""):
        candidate = (dist / path).resolve()
        if path and candidate.is_relative_to(dist) and candidate.is_file():
            return FileResponse(candidate)
        if not index.exists():
            raise HTTPException(404, "Painel do Mestre não foi instalado neste servidor.")
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


def create_app(settings: Settings | None = None) -> FastAPI:
    """Factory do app: `uvicorn app.main:create_app --factory` (ou `rpgplay-server serve`)."""
    settings = ensure_runtime_secrets(settings or get_settings())
    settings.data_path.mkdir(parents=True, exist_ok=True)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings.sqlalchemy_url)
        if settings.db_auto_create:
            await db.create_all()
        registry = get_registry()
        async with db.sessionmaker() as session:
            await sync_rulesets(session, registry)
        broadcaster = _build_broadcaster(settings)
        await broadcaster.start()
        state = AppState(
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
                upload=RateLimiter(20, 60),
                table=RateLimiter(60, 5),
            ),
            server_id=server_id(settings),
        )
        app.state.ctx = state
        discovery = None
        if settings.discovery_enabled:
            discovery = await start_discovery(
                settings.discovery_port,
                lambda: {
                    "app": "rpgplay",
                    "name": settings.server_name,
                    "version": __version__,
                    "server_id": state.server_id,
                    "port": settings.port,
                    "master_path": "/mestre",
                },
            )
        logger.info("RPG Play pronto: %s (%s pacotes de regras)", settings.server_name, len(registry.packs))
        try:
            yield
        finally:
            if discovery is not None:
                discovery.close()
            await broadcaster.stop()
            await db.dispose()

    app = FastAPI(
        title="RPG Play API",
        version=__version__,
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
        settings.media_path.mkdir(parents=True, exist_ok=True)
        app.mount("/media", StaticFiles(directory=settings.media_path), name="media")

    if settings.web_dist_dir:
        _mount_master_panel(app, Path(settings.web_dist_dir).resolve())

    return app
