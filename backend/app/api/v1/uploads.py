import asyncio

from fastapi import APIRouter, Depends, File, UploadFile, status

from app.api.deps import AppState, get_current_user, get_state
from app.core.errors import DomainError, RateLimitedError
from app.models import User
from app.schemas.misc import PortraitOut
from app.services.media import InvalidImageError, new_portrait_key, process_portrait

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/portrait", response_model=PortraitOut, status_code=status.HTTP_201_CREATED)
async def upload_portrait(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    state: AppState = Depends(get_state),
):
    """Recebe a foto já cortada no app, normaliza (512x512 JPEG, sem EXIF) e devolve a chave para a ficha."""
    if not state.limiters.upload.allow(f"upload:{user.id}"):
        raise RateLimitedError("Muitos envios seguidos. Aguarde um pouco.")
    data = await file.read(state.settings.max_upload_bytes + 1)
    if len(data) > state.settings.max_upload_bytes:
        raise DomainError("Imagem maior que 5 MB.")
    try:
        processed = await asyncio.to_thread(process_portrait, data)
    except InvalidImageError as exc:
        raise DomainError(str(exc)) from exc
    key = new_portrait_key(user.id)
    await state.media.put(key, processed, "image/jpeg")
    return PortraitOut(portrait_key=key, url=state.media.url(key))
