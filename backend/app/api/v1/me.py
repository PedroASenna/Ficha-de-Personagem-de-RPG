from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AppState, get_current_user, get_db, get_state
from app.models import User
from app.schemas.auth import UserOut, UserPatch
from app.services import account

router = APIRouter(prefix="/me", tags=["conta"])


@router.get("", response_model=UserOut)
async def read_me(user: User = Depends(get_current_user)):
    return user


@router.patch("", response_model=UserOut)
async def update_me(data: UserPatch, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if data.display_name is not None:
        user.display_name = data.display_name.strip()
    if data.locale is not None:
        user.locale = data.locale
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/export")
async def export_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Portabilidade (LGPD art. 18, V): todos os dados do usuário em JSON."""
    return await account.export_user_data(db, user)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), state: AppState = Depends(get_state)
):
    """Exclusão de conta dentro do app (exigência da Play Store e LGPD art. 18, VI)."""
    await account.delete_account(db, user, state.media)
