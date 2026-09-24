# PyInstaller: executável do servidor (modo onedir) com as migrações, os sistemas de regras e o painel do Mestre.
#   Linux:   packaging/server/build-deb.sh     Windows: packaging/windows/build.ps1
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).resolve().parents[1]
BACKEND = ROOT / "backend"
WEB_DIST = Path(os.environ.get("RPG_WEB_DIST", ROOT / "web" / "dist"))
if not (WEB_DIST / "index.html").exists():
    raise SystemExit(f"Painel do Mestre não compilado em {WEB_DIST} (rode: cd web && npm ci && npm run build)")

hiddenimports = [
    *collect_submodules("app"),
    *collect_submodules("uvicorn"),
    "aiosqlite",
    "asyncpg",
    "sqlalchemy.dialects.sqlite.aiosqlite",
    "sqlalchemy.dialects.postgresql.asyncpg",
    "websockets.asyncio.server",
    "websockets.legacy.server",
    "httptools",
    "multipart",
    "python_multipart",
]
WINDOWS = sys.platform == "win32"
if not WINDOWS:
    hiddenimports.append("uvloop")  # não existe no Windows (o uvicorn usa o asyncio padrão)

a = Analysis(
    [str(Path(SPECPATH) / "entry.py")],
    pathex=[str(BACKEND)],
    datas=[
        (str(BACKEND / "alembic"), "migrations"),
        (str(BACKEND / "app" / "rulesets" / "data"), "app/rulesets/data"),
        (str(WEB_DIST), "web_dist"),
    ],
    hiddenimports=hiddenimports,
    excludes=["tkinter", "_tkinter", "google", "pytest", "IPython"],
    noarchive=False,
)
# libstdc++/libgcc_s vêm do sistema (todo Debian/Ubuntu tem; os wheels manylinux contam com isso). Levar a cópia
# da máquina de build faria o pacote exigir a glibc dela.
a.binaries = [b for b in a.binaries if not Path(b[0]).name.startswith(("libstdc++.so", "libgcc_s.so"))]
ICON = ROOT / "packaging" / "windows" / "rpgplay.ico"

pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="rpgplay-server",
    console=True,
    icon=str(ICON) if WINDOWS else None,
    strip=False,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="rpgplay-server")
