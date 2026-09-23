from fastapi import APIRouter

from app.api.v1 import auth, characters, dice, me, moderation, rooms, rulesets, uploads

api_router = APIRouter(prefix="/api/v1")
for module in (auth, me, rulesets, characters, rooms, dice, uploads, moderation):
    api_router.include_router(module.router)
