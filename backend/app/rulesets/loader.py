import hashlib
import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Ruleset
from app.rulesets.schema import CatalogEntry, RulesetPack
from app.services.dice import OutcomeRules

DATA_DIR = Path(__file__).parent / "data"
CATALOG_FILE = "catalog.json"


@dataclass
class RulesetRegistry:
    packs: dict[str, RulesetPack] = field(default_factory=dict)
    catalog: list[CatalogEntry] = field(default_factory=list)

    def get(self, ruleset_id: str) -> RulesetPack | None:
        return self.packs.get(ruleset_id)

    def outcome_rules(self, ruleset_id: str) -> OutcomeRules:
        pack = self.get(ruleset_id)
        return OutcomeRules.from_dict(pack.dice.model_dump() if pack else None)


def load_registry(data_dir: Path = DATA_DIR) -> RulesetRegistry:
    registry = RulesetRegistry()
    for path in sorted(data_dir.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        if path.name == CATALOG_FILE:
            registry.catalog = [CatalogEntry.model_validate(entry) for entry in raw]
            continue
        pack = RulesetPack.model_validate(raw)
        if pack.id in registry.packs:
            raise ValueError(f"Pacote de regras duplicado: {pack.id}")
        registry.packs[pack.id] = pack
    clash = {c.id for c in registry.catalog} & set(registry.packs)
    if clash:
        raise ValueError(f"IDs no catálogo e em pacotes ao mesmo tempo: {clash}")
    return registry


@lru_cache
def get_registry() -> RulesetRegistry:
    return load_registry()


def _hash(data: dict) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


async def sync_rulesets(session: AsyncSession, registry: RulesetRegistry) -> None:
    """Upsert dos pacotes e do catálogo na tabela rulesets (roda no startup)."""
    existing = {r.id: r for r in (await session.scalars(select(Ruleset))).all()}
    rows = []
    for pack in registry.packs.values():
        data = pack.model_dump(mode="json")
        rows.append(
            {
                "id": pack.id,
                "version": pack.version,
                "name": pack.name,
                "license": pack.license,
                "license_url": pack.license_url,
                "attribution": pack.attribution,
                "status": pack.status,
                "pack": data,
                "content_hash": _hash(data),
            }
        )
    for entry in registry.catalog:
        data = entry.model_dump(mode="json")
        rows.append(
            {
                "id": entry.id,
                "version": "-",
                "name": entry.name,
                "license": entry.license,
                "license_url": entry.license_url,
                "attribution": "",
                "status": entry.status,
                "pack": None,
                "content_hash": _hash(data),
            }
        )
    for row in rows:
        current = existing.get(row["id"])
        if current is None:
            session.add(Ruleset(**row))
        elif current.content_hash != row["content_hash"] or current.status != row["status"]:
            for key, value in row.items():
                setattr(current, key, value)
    await session.commit()
