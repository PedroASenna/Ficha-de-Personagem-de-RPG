"""Servidor RPG Play no Windows (executável do instalador RPG-Play-Servidor-Setup.exe).

No Linux o pacote .deb cuida de usuário, pasta de dados, serviço e firewall. No Windows o servidor roda
numa janela do console aberta pelo menu Iniciar (ou junto com o Windows), e aqui ficam os detalhes:

- dados em ``C:\\ProgramData\\RPG Play\\servidor`` (qualquer usuário do PC abre a mesma campanha);
- configuração opcional em ``servidor.env`` nessa pasta (as mesmas variáveis RPG_* do Linux);
- saída em UTF-8 (acentos e ✔/✘ não quebram quando a saída vai para arquivo);
- regra do Firewall do Windows só para a rede local (``remoteip=localsubnet``).

As funções de texto e de montagem de comando não dependem do Windows, então são testáveis no Linux.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterable, MutableMapping
from pathlib import Path

IS_WINDOWS = sys.platform == "win32"
FIREWALL_RULE = "RPG Play Servidor"
ENV_FILE = "servidor.env"


def default_data_dir(environ: MutableMapping[str, str] = os.environ) -> Path:
    base = environ.get("PROGRAMDATA") or environ.get("ALLUSERSPROFILE") or r"C:\ProgramData"
    return Path(base) / "RPG Play" / "servidor"


def parse_env_lines(lines: Iterable[str]) -> dict[str, str]:
    """Lê linhas CHAVE=valor (como o server.env do Linux): ignora comentários e tira aspas."""
    values: dict[str, str] = {}
    for raw in lines:
        line = raw.strip().lstrip("\ufeff")
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def apply_defaults(environ: MutableMapping[str, str] = os.environ) -> Path:
    """Pasta de dados e servidor.env. Variáveis já definidas no ambiente têm prioridade. Devolve a pasta."""
    data_dir = Path(environ.get("RPG_DATA_DIR") or default_data_dir(environ))
    env_file = data_dir / ENV_FILE
    if env_file.is_file():
        for key, value in parse_env_lines(env_file.read_text(encoding="utf-8", errors="replace").splitlines()).items():
            environ.setdefault(key, value)
    environ.setdefault("RPG_DATA_DIR", str(data_dir))
    environ.setdefault("RPG_ENV", "prod")
    return Path(environ["RPG_DATA_DIR"])


def prepare_console(title: str = "RPG Play Servidor") -> None:
    """UTF-8 na saída (com substituição, nunca erro) e título da janela."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    if IS_WINDOWS:
        import ctypes

        ctypes.windll.kernel32.SetConsoleTitleW(title)


def owns_console() -> bool:
    """A janela do console é só nossa? (aberto pelo atalho, não por um terminal que já estava aberto)"""
    if not IS_WINDOWS or os.environ.get("RPG_NO_PAUSE") or not (sys.stdin and sys.stdin.isatty()):
        return False
    import ctypes

    processes = (ctypes.c_uint * 4)()
    return ctypes.windll.kernel32.GetConsoleProcessList(processes, 4) == 1


def is_admin() -> bool:
    if not IS_WINDOWS:
        return False
    import ctypes

    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except OSError:
        return False


def server_executable() -> Path:
    return Path(sys.executable).resolve()


def firewall_show_command() -> list[str]:
    return ["netsh", "advfirewall", "firewall", "show", "rule", f"name={FIREWALL_RULE}"]


def firewall_commands(program: Path | str) -> list[list[str]]:
    """Troca a regra do RPG Play por uma nova: entrada liberada para o programa, só da rede local.

    Regra por programa cobre TCP (celulares e painel) e UDP (descoberta) sem abrir portas para outros
    programas. ``remoteip=localsubnet`` vale mesmo quando o Windows marca o Wi-Fi como rede pública.
    """
    rule = f"name={FIREWALL_RULE}"
    return [
        ["netsh", "advfirewall", "firewall", "delete", "rule", rule],
        [
            "netsh",
            "advfirewall",
            "firewall",
            "add",
            "rule",
            rule,
            "dir=in",
            "action=allow",
            f"program={program}",
            "enable=yes",
            "profile=any",
            "remoteip=localsubnet",
            "description=Celulares e painel do Mestre na rede de casa (RPG Play)",
        ],
    ]
