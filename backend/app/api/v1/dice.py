from fastapi import APIRouter, Depends

from app.api.deps import AppState, get_current_user, get_state
from app.core.errors import DomainError, RateLimitedError
from app.models import User
from app.schemas.misc import RollIn, RollOut
from app.services import dice

router = APIRouter(prefix="/dice", tags=["dados"])


@router.post("/roll", response_model=RollOut)
async def roll_dice(data: RollIn, user: User = Depends(get_current_user), state: AppState = Depends(get_state)):
    """Rolagem solo (fora de mesa). Não é gravada: minimização de dados."""
    if not state.limiters.roll.allow(f"roll:{user.id}"):
        raise RateLimitedError("Calma! Muitas rolagens seguidas.")
    pack = state.registry.get(data.ruleset_id or "")
    try:
        roll, outcome, check, _total, _shown = dice.roll_request(
            pack.engine if pack else "classic",
            data.notation,
            target=data.target,
            wild=data.wild,
            rules=state.registry.outcome_rules(data.ruleset_id or ""),
        )
    except dice.NotationError as exc:
        raise DomainError(str(exc)) from exc
    return RollOut(roll=roll, outcome=outcome.to_dict(), check=check)
