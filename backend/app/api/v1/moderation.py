import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.errors import DomainError
from app.models import ContentReport, User, UserBlock
from app.schemas.misc import BlockIn, ReportIn

router = APIRouter(tags=["moderação"])


@router.post("/reports", status_code=status.HTTP_201_CREATED)
async def report_content(data: ReportIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Denúncia de conteúdo gerado por usuário. Vai para a fila de moderação (política de UGC da Play Store)."""
    report = ContentReport(reporter_id=user.id, **data.model_dump())
    db.add(report)
    await db.commit()
    return {"id": str(report.id), "status": report.status.value}


@router.get("/blocks", response_model=list[uuid.UUID])
async def list_blocks(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(UserBlock.blocked_id).where(UserBlock.blocker_id == user.id))
    return list(rows.all())


@router.post("/blocks", status_code=status.HTTP_204_NO_CONTENT)
async def block_user(data: BlockIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if data.user_id == user.id:
        raise DomainError("Você não pode bloquear a si mesmo.")
    if await db.get(User, data.user_id) is None:
        raise DomainError("Usuário não encontrado.")
    if await db.get(UserBlock, (user.id, data.user_id)) is None:
        db.add(UserBlock(blocker_id=user.id, blocked_id=data.user_id))
        await db.commit()


@router.delete("/blocks/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unblock_user(user_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(UserBlock).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == user_id))
    await db.commit()
