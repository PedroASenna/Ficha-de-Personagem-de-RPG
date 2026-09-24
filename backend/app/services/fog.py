"""Névoa de guerra: o que cada personagem já explorou em cada cena.

A cena é dividida em células (meia casa da grade, no máximo 256 por lado). Cada personagem tem um
mapa de bits por cena: 1 = explorado. Quando o boneco anda, tudo que fica a até `fog_radius` casas
do caminho é marcado. O jogador vê preto onde o personagem dele nunca andou; o Mestre vê a união de
todos, com o inexplorado só levemente escurecido.

Bits em ordem de linha (índice = linha * colunas + coluna), o bit 0 de cada byte é o primeiro.
"""

import base64
import math
import uuid
from collections.abc import Iterable, Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FogExplored, Scene

MAX_FOG_SIDE = 256

Point = tuple[float, float]


def geometry(scene: Scene) -> tuple[int, int, float]:
    """(colunas, linhas, tamanho da célula em px do mapa)."""
    cell = max(scene.grid_size / 2, max(scene.map_width, scene.map_height) / MAX_FOG_SIDE)
    return math.ceil(scene.map_width / cell), math.ceil(scene.map_height / cell), cell


def empty_bits(cols: int, rows: int) -> bytearray:
    return bytearray((cols * rows + 7) // 8)


def _samples(path: Sequence[Point], step: float) -> Iterable[Point]:
    """Pontos ao longo do caminho, sem pular células (um a cada meia célula)."""
    if not path:
        return
    yield path[0]
    for (x0, y0), (x1, y1) in zip(path, path[1:], strict=False):
        count = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / step))
        for i in range(1, count + 1):
            t = i / count
            yield x0 + (x1 - x0) * t, y0 + (y1 - y0) * t


def reveal(bits: bytearray, cols: int, rows: int, cell: float, path: Sequence[Point], radius: float) -> list[int]:
    """Marca as células a até `radius` px do caminho. Devolve só as que eram novas."""
    new: list[int] = []
    r2 = radius * radius
    for sx, sy in _samples(path, cell / 2):
        # A célula sob o boneco sempre conta, mesmo com raio pequeno.
        own = (int(sy // cell), int(sx // cell)) if 0 <= sx < cols * cell and 0 <= sy < rows * cell else None
        r0, r1 = max(0, int((sy - radius) // cell)), min(rows - 1, int((sy + radius) // cell))
        c0, c1 = max(0, int((sx - radius) // cell)), min(cols - 1, int((sx + radius) // cell))
        for row in range(r0, r1 + 1):
            dy2 = ((row + 0.5) * cell - sy) ** 2
            for col in range(c0, c1 + 1):
                if dy2 + ((col + 0.5) * cell - sx) ** 2 > r2 and (row, col) != own:
                    continue
                index = row * cols + col
                mask = 1 << (index & 7)
                if not bits[index >> 3] & mask:
                    bits[index >> 3] |= mask
                    new.append(index)
    return new


def encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


async def explore(session: AsyncSession, scene: Scene, character_id: uuid.UUID, path: Sequence[Point]) -> list[int]:
    """Registra o caminho do personagem na cena (sem commit). Devolve as células recém-exploradas."""
    cols, rows, cell = geometry(scene)
    row = await session.get(FogExplored, (scene.id, character_id))
    if row is None:
        row = FogExplored(scene_id=scene.id, character_id=character_id, cols=cols, rows=rows, cell=cell, data=b"")
        session.add(row)
        bits = empty_bits(cols, rows)
    elif (row.cols, row.rows, row.cell) != (cols, rows, cell):
        # O mapa ou a grade mudaram: a exploração antiga não vale mais.
        row.cols, row.rows, row.cell = cols, rows, cell
        bits = empty_bits(cols, rows)
    else:
        bits = bytearray(row.data)
    new = reveal(bits, cols, rows, cell, path, scene.fog_radius * scene.grid_size)
    if new or not row.data:
        row.data = bytes(bits)
    return new


async def scene_fog(session: AsyncSession, scene: Scene) -> list[dict]:
    """Exploração de todos os personagens na cena (visão do Mestre)."""
    cols, rows, cell = geometry(scene)
    found = await session.scalars(select(FogExplored).where(FogExplored.scene_id == scene.id))
    return [
        {"scene_id": str(scene.id), "character_id": str(f.character_id), "explored": encode(f.data)}
        for f in found
        if (f.cols, f.rows, f.cell) == (cols, rows, cell)
    ]


async def character_fog(session: AsyncSession, scene: Scene, character_id: uuid.UUID) -> dict:
    """O que um personagem explorou na cena (visão do jogador). Sem registro = tudo escuro."""
    cols, rows, cell = geometry(scene)
    found = await session.get(FogExplored, (scene.id, character_id))
    valid = found is not None and (found.cols, found.rows, found.cell) == (cols, rows, cell)
    data = found.data if valid and found is not None else bytes(empty_bits(cols, rows))
    return {"scene_id": str(scene.id), "character_id": str(character_id), "explored": encode(data)}


async def reset(session: AsyncSession, scene_id: uuid.UUID, character_id: uuid.UUID | None = None) -> None:
    query = delete(FogExplored).where(FogExplored.scene_id == scene_id)
    if character_id is not None:
        query = query.where(FogExplored.character_id == character_id)
    await session.execute(query)
