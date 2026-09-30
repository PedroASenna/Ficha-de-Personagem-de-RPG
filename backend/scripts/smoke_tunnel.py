"""Teste do link rápido com a Cloudflare de verdade (roda no CI, que tem internet).

Sobe o servidor, liga o link rápido pela API do admin (o servidor baixa o cloudflared do GitHub), espera o
link https e, pela internet, confere a descoberta e o cadastro com o código de acesso. Depende de serviço
externo, então o CI roda este passo sem bloquear.

    RPG_DATA_DIR=/tmp/x RPG_PORT=18080 python scripts/smoke_tunnel.py
"""

import os
import subprocess
import sys
import time

import httpx

PORT = int(os.environ.get("RPG_PORT", "18080"))
LAN = f"http://127.0.0.1:{PORT}/api/v1"


def wait(what: str, check, timeout: float):  # noqa: ANN001
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except httpx.HTTPError as exc:
            last = exc
        time.sleep(2)
    raise SystemExit(f"FALHOU: {what} (último erro: {last})")


def main() -> int:
    server = subprocess.Popen([sys.executable, "-m", "app.server_cli", "serve"])  # noqa: S603
    try:
        wait("servidor subir", lambda: httpx.get(f"http://127.0.0.1:{PORT}/health").status_code == 200, 60)
        body = {"username": "dono", "password": "senha-do-dono", "display_name": "Dono"}
        token = httpx.post(f"{LAN}/auth/register", json=body).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        httpx.put(f"{LAN}/remote", json={"mode": "quick"}, headers=headers).raise_for_status()

        def tunnel_on():
            view = httpx.get(f"{LAN}/remote", headers=headers).json()
            print("  situação:", view["status"], view.get("error") or "")
            return view if view["status"] == "on" else None

        view = wait("link rápido no ar", tunnel_on, 180)
        url, code = view["url"], view["access_code"]
        print("Link:", url)

        def discovery():
            response = httpx.get(f"{url}/api/v1/discovery", timeout=20)
            return response.json() if response.status_code == 200 else None

        info = wait("descoberta pela internet", discovery, 90)
        assert info["access_code_required"] is False and info["addresses"] == [], info
        # Criar conta pela internet é livre (as mesas pedem aprovação)...
        player = {"username": "longe", "password": "senha-de-longe", "display_name": "De Longe"}
        created = httpx.post(f"{url}/api/v1/auth/register", json=player, timeout=20)
        assert created.status_code == 201, created.text
        # ...a não ser que o admin exija o código de acesso.
        httpx.put(f"{LAN}/remote", json={"require_code": True}, headers=headers).raise_for_status()
        other = {"username": "outro", "password": "senha-do-outro", "display_name": "Outro"}
        denied = httpx.post(f"{url}/api/v1/auth/register", json=other, timeout=20)
        assert denied.status_code == 403, denied.text
        allowed = httpx.post(f"{url}/api/v1/auth/register", json={**other, "access_code": code}, timeout=20)
        assert allowed.status_code == 201, allowed.text
        invite = httpx.get(f"{url}/entrar?pin=ABC123", timeout=20)
        assert invite.status_code == 200 and "rpgplay://join" in invite.text
        print("OK: link rápido da Cloudflare funcionando (descoberta, código de acesso e convite).")
        return 0
    finally:
        server.terminate()
        server.wait(30)


if __name__ == "__main__":
    sys.exit(main())
