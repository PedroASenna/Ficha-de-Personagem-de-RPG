from fastapi import APIRouter, Depends

from app import __version__
from app.api.deps import AppState, get_state
from app.core.discovery import lan_addresses
from app.schemas.auth import DiscoveryOut

router = APIRouter(tags=["rede local"])


@router.get("/discovery", response_model=DiscoveryOut)
async def discovery(state: AppState = Depends(get_state)):
    """Responde "sou um servidor RPG Play" para quem varre a rede local (app e programa do Mestre)."""
    return DiscoveryOut(
        name=state.settings.server_name,
        version=__version__,
        server_id=state.server_id,
        port=state.settings.port,
        registration_open=state.settings.allow_registration,
        addresses=lan_addresses(),
    )
