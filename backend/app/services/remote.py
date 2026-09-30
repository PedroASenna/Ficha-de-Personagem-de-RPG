"""Acesso pela internet, de graça e sem abrir portas no roteador (funciona até atrás de CGNAT).

Dois jeitos, escolhidos pelo admin no painel:

- ``quick`` (link rápido): o Cloudflare Quick Tunnel. O servidor roda ``cloudflared tunnel --url`` e recebe um
  endereço https://xxxx.trycloudflare.com. Não precisa de conta. O link muda sempre que o túnel reabre
  (reinício do servidor ou do PC). O ``cloudflared`` é baixado do GitHub da Cloudflare na primeira vez.
- ``fixed`` (link fixo): o Tailscale Funnel, com endereço que não muda (https://pc.tailnet.ts.net). O Mestre
  instala o Tailscale, entra na conta grátis e roda uma vez ``rpgplay-server internet fixo`` (que chama
  ``tailscale funnel --bg``). Aqui o servidor só descobre o endereço e confere se responde.

Os dois entregam o tráfego em 127.0.0.1:``remote_port``: tudo o que chega por essa porta é "de fora" (veja
``app/core/origin.py``). Quem vem de fora cria conta e personagem livremente; a proteção é a aprovação de
entrada nas mesas. O admin pode também exigir um código de acesso para criar conta (``require_code``).

O estado fica em ``{data_dir}/remote.json`` (modo, código de acesso e se ele é exigido, último link fixo).
"""

import asyncio
import contextlib
import hmac
import json
import logging
import os
import platform
import re
import secrets
import shutil
import sys
from pathlib import Path
from typing import Any, Literal

import httpx

from app.core.config import Settings

logger = logging.getLogger("rpgplay.remote")

Mode = Literal["off", "quick", "fixed"]
Status = Literal["off", "downloading", "starting", "on", "error"]

QUICK_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.IGNORECASE)
# Mesmo alfabeto do PIN da mesa: sem 0/O e 1/I, para ditar por mensagem sem confusão.
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
WINDOWS_TAILSCALE = Path(r"C:\Program Files\Tailscale\tailscale.exe")
START_TIMEOUT = 90.0
FIXED_HINT = (
    "No computador do servidor, abra uma vez “Link fixo pela internet (Tailscale)” no menu Iniciar."
    if sys.platform == "win32"
    else "No computador do servidor, rode uma vez: sudo rpgplay-server internet fixo"
)
DISABLED = (
    "O acesso pela internet está desligado neste servidor (RPG_INTERNET_ENABLED=false na configuração, ou a"
    " porta de internet estava ocupada quando o servidor abriu)."
)


def new_access_code() -> str:
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_code(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def cloudflared_asset(system: str | None = None, machine: str | None = None) -> str:
    """Nome do executável no Release da Cloudflare para esta máquina."""
    system = (system or platform.system()).lower()
    machine = (machine or platform.machine()).lower()
    if system == "windows":
        return "cloudflared-windows-amd64.exe" if machine in ("amd64", "x86_64") else "cloudflared-windows-386.exe"
    if system == "linux":
        if machine in ("x86_64", "amd64"):
            return "cloudflared-linux-amd64"
        if machine in ("aarch64", "arm64"):
            return "cloudflared-linux-arm64"
        if machine.startswith("arm"):
            return "cloudflared-linux-arm"
        if machine in ("i386", "i686", "x86"):
            return "cloudflared-linux-386"
    raise RuntimeError(f"O link rápido não tem o programa da Cloudflare para {system}/{machine}.")


def tailscale_dns_url(status: dict[str, Any]) -> str | None:
    """Endereço público do Funnel a partir de ``tailscale status --json``."""
    dns = str((status.get("Self") or {}).get("DNSName") or "").rstrip(".")
    return f"https://{dns}" if dns else None


class RemoteAccess:
    def __init__(self, settings: Settings, server_id: str = "") -> None:
        self.settings = settings
        self.server_id = server_id
        self.path = settings.data_path / "remote.json"
        data = self._load()
        self.mode: Mode = data.get("mode") if data.get("mode") in ("off", "quick", "fixed") else "off"
        self.access_code: str = data.get("access_code") or new_access_code()
        # Desligado por padrão: criar conta e personagem não depende do Mestre (a mesa pede aprovação).
        self.require_code: bool = data.get("require_code") is True
        self.fixed_url: str | None = data.get("fixed_url")
        self.status: Status = "off"
        self.url: str | None = None
        self.error: str | None = None
        self._task: asyncio.Task | None = None
        self._proc: asyncio.subprocess.Process | None = None

    # ---------- estado ----------

    def _load(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # current_url é só informativo (``rpgplay-server internet`` mostra o link sem precisar do painel).
        data = {
            "mode": self.mode,
            "access_code": self.access_code,
            "require_code": self.require_code,
            "fixed_url": self.fixed_url,
            "current_url": self.url if self.status == "on" else None,
        }
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        with contextlib.suppress(OSError):
            tmp.chmod(0o600)
        tmp.replace(self.path)

    @property
    def enabled(self) -> bool:
        """O Mestre ligou o acesso pela internet (mesmo que o túnel ainda esteja abrindo)."""
        return self.mode != "off"

    def code_matches(self, value: str | None) -> bool:
        return hmac.compare_digest(normalize_code(value), normalize_code(self.access_code))

    def set_require_code(self, value: bool) -> None:
        self.require_code = value
        self.save()

    def new_code(self) -> str:
        self.access_code = new_access_code()
        self.save()
        return self.access_code

    def view(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "status": self.status,
            "url": self.url,
            "fixed_url": self.fixed_url,
            "error": self.error,
            "access_code": self.access_code,
            "require_code": self.require_code,
            "internet_port": self.settings.remote_port,
            "available": self.settings.internet_enabled,
        }

    # ---------- ciclo de vida ----------

    async def start(self) -> None:
        """Liga o que o modo pede (no startup do servidor e depois de trocar o modo)."""
        await self.stop()
        self.error = None
        if self.mode != "off" and not self.settings.internet_enabled:
            self.status = "error"
            self.error = DISABLED
        elif self.mode == "quick":
            self.status = "starting"
            self._task = asyncio.create_task(self._run_quick())
        elif self.mode == "fixed":
            self.status = "starting"
            self._task = asyncio.create_task(self._run_fixed())
        else:
            self.status = "off"
            self.url = None

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        await self._kill()
        was_on = self.status == "on"
        self.url = None
        self.status = "off"
        if was_on:
            with contextlib.suppress(OSError):
                self.save()

    async def set_mode(self, mode: Mode) -> None:
        self.mode = mode
        self.save()
        await self.start()

    async def _kill(self) -> None:
        proc, self._proc = self._proc, None
        if proc is None or proc.returncode is not None:
            return
        with contextlib.suppress(ProcessLookupError):
            proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), 5)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            await proc.wait()

    # ---------- link rápido (Cloudflare) ----------

    def _bin_dir(self) -> Path:
        return self.settings.data_path / "bin"

    async def ensure_cloudflared(self) -> str:
        if self.settings.cloudflared_path:
            return self.settings.cloudflared_path
        found = shutil.which("cloudflared")
        if found:
            return found
        target = self._bin_dir() / ("cloudflared.exe" if sys.platform == "win32" else "cloudflared")
        if target.is_file():
            return str(target)
        asset = cloudflared_asset()
        self.status = "downloading"
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(".download")
        url = f"{self.settings.cloudflared_download_url.rstrip('/')}/{asset}"
        logger.info("Baixando o programa do link rápido: %s", url)
        try:
            async with (
                httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(30, read=120)) as client,
                client.stream("GET", url) as response,
            ):
                response.raise_for_status()
                with partial.open("wb") as out:
                    async for chunk in response.aiter_bytes():
                        out.write(chunk)
        except httpx.HTTPError as exc:
            partial.unlink(missing_ok=True)
            raise RuntimeError(f"Não consegui baixar o programa da Cloudflare ({exc}). Confira a internet.") from exc
        partial.chmod(0o755)
        partial.replace(target)
        return str(target)

    async def _wait_local_port(self) -> None:
        """O túnel entrega na porta de internet; ela abre logo depois do startup do servidor."""
        port = self.settings.remote_port
        for _ in range(30):
            try:
                _, writer = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", port), 2)
            except (OSError, TimeoutError):
                await asyncio.sleep(0.5)
                continue
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()
            return
        raise RuntimeError(
            f"Ninguém atende na porta de internet {port} deste computador. Abra o servidor pelo"
            " rpgplay-server (serviço ou atalho), não direto pelo uvicorn."
        )

    async def _run_quick(self) -> None:
        attempt = 0
        while self.mode == "quick":
            try:
                binary = await self.ensure_cloudflared()
                self.status = "starting"
                await self._wait_local_port()
                await self._tunnel_once(binary)
                if self.mode == "quick":
                    self.error = self.error or "O túnel da Cloudflare caiu; reabrindo (o link vai mudar)."
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - qualquer falha vira mensagem no painel e nova tentativa
                logger.warning("Link rápido: %s", exc)
                self.error = str(exc)
            self.url = None
            self.status = "error"
            attempt += 1
            await asyncio.sleep(min(60, 2**attempt))

    async def _tunnel_once(self, binary: str) -> None:
        env = {**os.environ, "HOME": str(self.settings.data_path), "NO_AUTOUPDATE": "true"}
        self._proc = await asyncio.create_subprocess_exec(
            binary,
            "tunnel",
            "--no-autoupdate",
            "--url",
            f"http://127.0.0.1:{self.settings.remote_port}",
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        proc = self._proc
        last_error = None
        assert proc.stderr is not None
        started = asyncio.get_running_loop().time()
        while True:
            timeout = None if self.url else max(1.0, START_TIMEOUT - (asyncio.get_running_loop().time() - started))
            try:
                raw = await asyncio.wait_for(proc.stderr.readline(), timeout)
            except TimeoutError:
                self.error = "A Cloudflare está demorando para abrir o link. Confira a internet do servidor."
                continue
            if not raw:
                break
            line = raw.decode("utf-8", "replace").strip()
            if " ERR " in f" {line} ":
                last_error = line
            match = QUICK_URL.search(line)
            if match and not self.url:
                self.url = match.group(0)
                self.status = "on"
                self.error = None
                with contextlib.suppress(OSError):
                    self.save()
                logger.info("Link rápido pela internet: %s", self.url)
        code = await proc.wait()
        self._proc = None
        if last_error or code:
            self.error = f"O programa da Cloudflare parou (código {code})." + (
                f" {last_error[-200:]}" if last_error else ""
            )

    # ---------- link fixo (Tailscale) ----------

    def tailscale_binary(self) -> str | None:
        if self.settings.tailscale_path:
            return self.settings.tailscale_path
        found = shutil.which("tailscale")
        if found:
            return found
        return str(WINDOWS_TAILSCALE) if sys.platform == "win32" and WINDOWS_TAILSCALE.is_file() else None

    async def _tailscale_json(self, *args: str) -> dict[str, Any]:
        binary = self.tailscale_binary()
        if binary is None:
            raise RuntimeError("O Tailscale não está instalado neste computador (tailscale.com/download).")
        proc = await asyncio.create_subprocess_exec(
            binary,
            *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), 20)
        if proc.returncode != 0:
            raise RuntimeError(err.decode("utf-8", "replace").strip() or f"tailscale {' '.join(args)} falhou.")
        return json.loads(out.decode("utf-8", "replace") or "{}")

    async def _run_fixed(self) -> None:
        """No boot o Tailscale pode abrir depois do servidor: tenta de novo até o link responder."""
        attempt = 0
        while self.mode == "fixed":
            await self.check_fixed()
            if self.status == "on":
                return
            attempt += 1
            await asyncio.sleep(min(60, 2**attempt))

    async def check_fixed(self) -> dict[str, Any]:
        """Descobre o endereço do Funnel e confere se ele chega neste servidor."""
        self.status = "starting"
        try:
            status = await self._tailscale_json("status", "--json")
            if status.get("BackendState") not in (None, "Running"):
                raise RuntimeError("Entre na sua conta do Tailscale neste computador (o Tailscale está desligado).")
            url = tailscale_dns_url(status)
            if not url:
                raise RuntimeError("O Tailscale não informou o nome deste computador. Ative o MagicDNS na conta.")
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    response = await client.get(f"{url}/api/v1/discovery")
            except httpx.HTTPError as exc:
                raise RuntimeError(f"O link fixo {url} ainda não responde.") from exc
            try:
                info = response.json() if response.status_code == 200 else {}
            except ValueError:
                info = {}
            if info.get("app") != "rpgplay" or (self.server_id and info.get("server_id") != self.server_id):
                raise RuntimeError("O link fixo não chega neste servidor.")
        except Exception as exc:  # noqa: BLE001
            self.error = f"{exc} {FIXED_HINT}"
            self.status = "error"
            return self.view()
        self.url = url
        self.fixed_url = url
        self.error = None
        self.status = "on"
        self.save()
        return self.view()
