"""Compatibilidade: `python -m app.cli purge` = `rpgplay-server purge`."""

import sys

from app.server_cli import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
