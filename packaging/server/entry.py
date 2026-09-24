"""Ponto de entrada do executável rpgplay-server (PyInstaller): pacote .deb e instalador do Windows."""

import os
import sys
import traceback

from app.core import winhost


def run() -> int:
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    if winhost.IS_WINDOWS:
        # Antes de ler a configuração: pasta de dados em ProgramData e o servidor.env de lá.
        winhost.apply_defaults()
        winhost.prepare_console()
    from app.server_cli import main

    try:
        code = main(sys.argv[1:])
    except KeyboardInterrupt:
        code = 0
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 1)
    except Exception:
        traceback.print_exc()
        code = 1
    if code and winhost.owns_console():
        # Aberto pelo atalho do menu Iniciar: sem isto a janela fecha antes de dar para ler o erro.
        try:
            input("\nAperte Enter para fechar esta janela.")
        except EOFError:
            pass
    return code


if __name__ == "__main__":
    sys.exit(run())
