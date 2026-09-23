from fastapi import APIRouter

from app.api.v1 import admin, auth, characters, dice, discovery, me, moderation, rooms, rulesets, table, uploads

api_router = APIRouter(prefix="/api/v1")
for module in (discovery, auth, admin, me, rulesets, characters, rooms, table, dice, uploads, moderation):
    api_router.include_router(module.router)
