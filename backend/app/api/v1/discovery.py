from fastapi import APIRouter, Depends, Request

from app import __version__
from app.api.deps import AppState, get_state
from app.core.discovery import lan_addresses
from app.core.origin import is_remote
from app.schemas.auth import DiscoveryOut

router = APIRouter(tags=["rede local"])


@router.get("/discovery", response_model=DiscoveryOut)
async def discovery(request: Request, state: AppState = Depends(get_state)):
    """Responde "sou um servidor RPG Play" para quem varre a rede local (app e programa do Mestre).

    Pela internet: sem os IPs da casa, e avisa se o cadastro pede o código de acesso."""
    remote = is_remote(request.scope, state.settings)
    open_ = state.settings.allow_registration and (state.remote.enabled or not remote)
    return DiscoveryOut(
        name=state.settings.server_name,
        version=__version__,
        server_id=state.server_id,
        port=state.settings.port,
        registration_open=open_,
        addresses=[] if remote else lan_addresses(),
        internet=state.remote.enabled,
        access_code_required=remote and state.remote.require_code,
    )
