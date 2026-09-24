from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import AppState, get_state
from app.schemas.misc import RulesetSummary

router = APIRouter(prefix="/rulesets", tags=["regras"])


@router.get("", response_model=list[RulesetSummary])
async def list_rulesets(state: AppState = Depends(get_state)):
    """Tudo que o Mestre vê ao criar a sala: disponíveis primeiro, depois planejados e restritos."""
    available = [
        RulesetSummary(
            id=p.id,
            name=p.name,
            short_name=p.short_name,
            version=p.version,
            status=p.status,
            license=p.license,
            license_url=p.license_url,
            attribution=p.attribution,
            description=p.description,
            engine=p.engine,
        )
        for p in state.registry.packs.values()
    ]
    catalog = [
        RulesetSummary(
            id=c.id,
            name=c.name,
            version="-",
            status=c.status,
            license=c.license,
            license_url=c.license_url,
            attribution="",
            description="",
            notes=c.notes,
        )
        for c in state.registry.catalog
    ]
    order = {"available": 0, "planned": 1, "restricted": 2}
    return sorted(available + catalog, key=lambda r: (order[r.status], r.name))


@router.get("/{ruleset_id}")
async def get_ruleset(ruleset_id: str, state: AppState = Depends(get_state)):
    """Pacote completo (atributos, raças, classes...) usado pelo wizard."""
    pack = state.registry.get(ruleset_id)
    if pack is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sistema de regras não encontrado.")
    return pack.model_dump(mode="json")
