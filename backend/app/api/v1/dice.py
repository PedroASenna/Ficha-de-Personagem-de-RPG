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
    try:
        expression = dice.parse(data.notation)
    except dice.NotationError as exc:
        raise DomainError(str(exc)) from exc
    result = dice.roll(expression)
    outcome = dice.classify(result, state.registry.outcome_rules(data.ruleset_id or ""))
    return RollOut(roll=result.to_dict(), outcome=outcome.to_dict())
