from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AppState, get_current_user, get_db, get_state
from app.core.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    verify_password,
)
from app.models import RefreshToken, User
from app.schemas.auth import LoginIn, PasswordChangeIn, RefreshIn, RegisterIn, TokenOut

router = APIRouter(prefix="/auth", tags=["auth"])


async def _issue_tokens(db: AsyncSession, state: AppState, user: User) -> TokenOut:
    token, token_hash = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(UTC) + timedelta(days=state.settings.jwt_refresh_ttl_days),
        )
    )
    await db.commit()
    return TokenOut(
        access_token=create_access_token(state.settings, user.id),
        refresh_token=token,
        expires_in=state.settings.jwt_access_ttl_minutes * 60,
    )


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(data: RegisterIn, db: AsyncSession = Depends(get_db), state: AppState = Depends(get_state)):
    active_users = await db.scalar(select(func.count()).select_from(User).where(User.deleted_at.is_(None)))
    # O primeiro cadastro sempre é permitido (é o dono do servidor) e vira admin.
    if active_users and not state.settings.allow_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cadastro fechado neste servidor. Peça ao admin.")
    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        locale=data.locale,
        is_admin=active_users == 0,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Esse nome de usuário já existe.") from None
    return await _issue_tokens(db, state, user)


@router.post("/login", response_model=TokenOut)
async def login(
    data: LoginIn, request: Request, db: AsyncSession = Depends(get_db), state: AppState = Depends(get_state)
):
    client = request.client.host if request.client else "?"
    if not state.limiters.login.allow(f"login:{client}:{data.username}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas tentativas. Aguarde um minuto.")
    user = await db.scalar(select(User).where(User.username == data.username, User.deleted_at.is_(None)))
    if user is None or not verify_password(user.password_hash, data.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário ou senha incorretos.")
    return await _issue_tokens(db, state, user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    data: PasswordChangeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    if not verify_password(user.password_hash, data.current_password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Senha atual incorreta.")
    user.password_hash = hash_password(data.new_password)
    await db.commit()


@router.post("/refresh", response_model=TokenOut)
async def refresh(data: RefreshIn, db: AsyncSession = Depends(get_db), state: AppState = Depends(get_state)):
    stored = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(data.refresh_token))
    )
    expires_at = stored.expires_at if stored else None
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if stored is None or stored.revoked_at is not None or expires_at < datetime.now(UTC):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada. Entre novamente.")
    user = await db.get(User, stored.user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada. Entre novamente.")
    # Rotação: cada refresh token vale uma vez só.
    stored.revoked_at = datetime.now(UTC)
    return await _issue_tokens(db, state, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(data: RefreshIn, db: AsyncSession = Depends(get_db)):
    stored = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(data.refresh_token))
    )
    if stored and stored.revoked_at is None:
        stored.revoked_at = datetime.now(UTC)
        await db.commit()
