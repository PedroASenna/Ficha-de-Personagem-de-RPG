"""Tarefas de manutenção. Uso: python -m app.cli purge (Cloud Run Job + Cloud Scheduler, 1x por dia)."""

import asyncio
import sys

from app.core.config import get_settings
from app.db.session import Database
from app.services.account import purge


async def _purge() -> None:
    settings = get_settings()
    db = Database(settings.database_url)
    try:
        async with db.sessionmaker() as session:
            result = await purge(session, settings)
        print(f"Expurgo concluído: {result}")
    finally:
        await db.dispose()


def main(argv: list[str]) -> int:
    if argv[1:] == ["purge"]:
        asyncio.run(_purge())
        return 0
    print("Uso: python -m app.cli purge", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
