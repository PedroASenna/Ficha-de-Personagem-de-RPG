from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.rate_limit import RateLimiter
from app.core.security import InvalidTokenError, decode_access_token
from app.db.session import Database
from app.models import User
from app.rulesets.loader import RulesetRegistry
from app.services.media import MediaStore
from app.ws.broadcaster import Broadcaster


@dataclass
class Limiters:
    login: RateLimiter
    join_pin: RateLimiter
    roll: RateLimiter
    hp: RateLimiter
    upload: RateLimiter


@dataclass
class AppState:
    settings: Settings
    db: Database
    registry: RulesetRegistry
    media: MediaStore
    broadcaster: Broadcaster
    limiters: Limiters


def get_state(request: Request) -> AppState:
    return request.app.state.ctx


async def get_db(state: AppState = Depends(get_state)) -> AsyncIterator[AsyncSession]:
    async with state.db.sessionmaker() as session:
        yield session


_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sessão expirada. Entre novamente.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None:
        raise unauthorized
    try:
        user_id = decode_access_token(state.settings, creds.credentials)
    except InvalidTokenError:
        raise unauthorized from None
    user = await db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise unauthorized
    return user
