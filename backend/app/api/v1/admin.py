from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_admin_user, get_db
from app.core.security import hash_password
from app.models import RefreshToken, User
from app.schemas.auth import AdminPasswordResetIn, UserOut

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
async def list_users(_: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(User).where(User.deleted_at.is_(None)).order_by(User.username))
    return list(rows.all())


@router.post("/users/{username}/password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    username: str, data: AdminPasswordResetIn, _: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)
):
    """Sem e-mail de recuperação: o admin define uma senha nova e as sessões antigas caem."""
    user = await db.scalar(select(User).where(User.username == username.lower(), User.deleted_at.is_(None)))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")
    user.password_hash = hash_password(data.new_password)
    for token in await db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id)):
        await db.delete(token)
    await db.commit()
