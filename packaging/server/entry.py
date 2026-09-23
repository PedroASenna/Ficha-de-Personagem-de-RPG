"""Ponto de entrada do executável rpgplay-server (PyInstaller)."""

import os
import sys

from app.server_cli import main

if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    sys.exit(main(sys.argv[1:]))
