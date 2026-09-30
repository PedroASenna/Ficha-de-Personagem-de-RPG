from fastapi import APIRouter

from app.api.v1 import (
    admin,
    auth,
    characters,
    dice,
    discovery,
    me,
    moderation,
    remote,
    rooms,
    rulesets,
    table,
    uploads,
    world,
)

api_router = APIRouter(prefix="/api/v1")
for module in (
    discovery,
    auth,
    admin,
    remote,
    me,
    rulesets,
    characters,
    rooms,
    table,
    world,
    dice,
    uploads,
    moderation,
):
    api_router.include_router(module.router)
