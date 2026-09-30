"""Acesso pela internet (painel do Mestre): liga o link rápido ou o fixo, mostra o link e o código de acesso."""

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AppState, get_admin_user, get_current_user, get_db, get_state
from app.core.errors import ForbiddenError
from app.models import Room, User
from app.models.enums import RoomStatus

router = APIRouter(prefix="/remote", tags=["internet"])


class RemoteOut(BaseModel):
    mode: Literal["off", "quick", "fixed"]
    status: Literal["off", "downloading", "starting", "on", "error"]
    url: str | None = None
    fixed_url: str | None = None
    error: str | None = None
    access_code: str
    require_code: bool = False
    internet_port: int
    available: bool = True


class RemoteModeIn(BaseModel):
    mode: Literal["off", "quick", "fixed"] | None = None
    # Exigir o código de acesso para criar conta pela internet (desligado por padrão).
    require_code: bool | None = None


class RemoteShareOut(BaseModel):
    """O que o Mestre passa para quem joga de longe: o link (e o código de acesso, se o admin exige)."""

    enabled: bool
    status: Literal["off", "downloading", "starting", "on", "error"]
    url: str | None = None
    access_code: str | None = None


@router.get("", response_model=RemoteOut)
async def read_remote(_: User = Depends(get_admin_user), state: AppState = Depends(get_state)):
    return state.remote.view()


@router.put("", response_model=RemoteOut)
async def set_remote(
    data: RemoteModeIn,
    _: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Liga/desliga o acesso pela internet e a exigência do código. Ao ligar, as mesas abertas passam a pedir
    aprovação de entrada (cada Mestre pode desligar na própria mesa)."""
    if data.require_code is not None:
        state.remote.set_require_code(data.require_code)
    if data.mode is None or data.mode == state.remote.mode:
        return state.remote.view()
    was_enabled = state.remote.enabled
    await state.remote.set_mode(data.mode)
    if state.remote.enabled and not was_enabled:
        await db.execute(update(Room).where(Room.status == RoomStatus.OPEN).values(require_approval=True))
        await db.commit()
    return state.remote.view()


@router.post("/code", response_model=RemoteOut)
async def new_code(_: User = Depends(get_admin_user), state: AppState = Depends(get_state)):
    """Troca o código de acesso (quem já tem conta continua entrando normalmente)."""
    state.remote.new_code()
    return state.remote.view()


@router.post("/check", response_model=RemoteOut)
async def check_remote(_: User = Depends(get_admin_user), state: AppState = Depends(get_state)):
    """Confere de novo: no link fixo, se o Tailscale já está pronto; no rápido, reabre o túnel se caiu."""
    if state.remote.mode == "fixed":
        await state.remote.check_fixed()
    elif state.remote.mode == "quick" and state.remote.status == "error":
        await state.remote.start()
    return state.remote.view()


@router.get("/share", response_model=RemoteShareOut)
async def share(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    state: AppState = Depends(get_state),
):
    """Para o admin e para quem mestra alguma mesa aberta (o QR "pela internet" do painel)."""
    if not user.is_admin:
        masters = await db.scalar(
            select(Room.id).where(Room.master_id == user.id, Room.status == RoomStatus.OPEN).limit(1)
        )
        if masters is None:
            raise ForbiddenError("Só o Mestre de uma mesa vê o link pela internet.")
    remote = state.remote
    on = remote.enabled and remote.status == "on"
    return RemoteShareOut(
        enabled=remote.enabled,
        status=remote.status,
        url=remote.url if on else None,
        access_code=remote.access_code if remote.enabled and remote.require_code else None,
    )
