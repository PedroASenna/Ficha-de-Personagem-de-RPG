"""Smoke test ponta a ponta contra um servidor rodando (em casa ou no container).

    python scripts/smoke_test.py http://localhost:8080

Confere a descoberta, cria Mestre e jogadora (contas locais), abre a mesa (SRD 5.1), entra pelo PIN,
monta a mesa virtual (cena com mapa, inimigo e bonecos), move um boneco, rola 1d20+5 e aplica dano pelo
WebSocket, e confere que cada um recebeu o que devia e que o log da sessão registrou os eventos.
"""

import asyncio
import io
import json
import sys
import uuid

import httpx
import websockets
from PIL import Image


def png_bytes(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (40, 90, 50)).save(buffer, format="PNG")
    return buffer.getvalue()


async def main(base: str) -> None:
    ws_base = base.replace("http", "ws", 1)
    async with httpx.AsyncClient(base_url=base, timeout=10) as http:
        info = (await http.get("/api/v1/discovery")).json()
        assert info["app"] == "rpgplay", info
        print(f"Servidor: {info['name']} v{info['version']} id={info['server_id']}")

        async def register(name: str) -> dict:
            username = f"{name.lower()}_{uuid.uuid4().hex[:6]}"
            r = await http.post(
                "/api/v1/auth/register",
                json={"username": username, "password": "senha-do-smoke-test", "display_name": name},
            )
            r.raise_for_status()
            login = await http.post(
                "/api/v1/auth/login", json={"username": username, "password": "senha-do-smoke-test"}
            )
            login.raise_for_status()
            token = login.json()["access_token"]
            return {"Authorization": f"Bearer {token}", "token": token}

        master, player = await register("Mestre"), await register("Jogadora")
        hm = {"Authorization": master["Authorization"]}
        hp_ = {"Authorization": player["Authorization"]}

        rulesets = (await http.get("/api/v1/rulesets")).json()
        print("Sistemas disponíveis:", [r["id"] for r in rulesets if r["status"] == "available"])
        room = (await http.post("/api/v1/rooms", json={"name": "Smoke", "ruleset_id": "srd-5.1"}, headers=hm)).json()
        print(f"Sala criada: {room['name']} PIN={room['pin']} regras={room['ruleset_name']}")

        character = (
            await http.post("/api/v1/characters/quick", json={"ruleset_id": "srd-5.1", "name": "Lyra"}, headers=hp_)
        ).json()
        print(
            f"Personagem: {character['name']} ({character['ancestry_name']} {character['class_name']}) PV {character['hp_max']}"
        )
        r = await http.post(
            "/api/v1/rooms/join", json={"pin": room["pin"], "character_id": character["id"]}, headers=hp_
        )
        r.raise_for_status()

        # Mesa virtual: mapa, cena, um goblin e os dois bonecos na mesma cena.
        upload = await http.post(
            f"/api/v1/rooms/{room['id']}/images?kind=map",
            files={"file": ("mapa.png", png_bytes(800, 600), "image/png")},
            headers=hm,
        )
        upload.raise_for_status()
        image = upload.json()
        scene = (
            await http.post(
                f"/api/v1/rooms/{room['id']}/scenes",
                json={
                    "name": "Estrada",
                    "map_key": image["key"],
                    "map_width": image["width"],
                    "map_height": image["height"],
                },
                headers=hm,
            )
        ).json()
        goblin = (
            await http.post(f"/api/v1/rooms/{room['id']}/npcs", json={"name": "Goblin", "hp_max": 7}, headers=hm)
        ).json()[0]
        tokens = {}
        for key, body in (("lyra", {"character_id": character["id"]}), ("goblin", {"npc_id": goblin["id"]})):
            r = await http.post(
                f"/api/v1/rooms/{room['id']}/tokens",
                json={"scene_id": scene["id"], "x": 70, "y": 70, **body},
                headers=hm,
            )
            r.raise_for_status()
            tokens[key] = r.json()
        assert (await http.get(image["url"])).status_code == 200
        print(f"Mesa virtual: cena {scene['name']} ({image['width']}x{image['height']}), bonecos {list(tokens)}")

        async with (
            websockets.connect(f"{ws_base}/ws/rooms/{room['pin']}") as mws,
            websockets.connect(f"{ws_base}/ws/rooms/{room['pin']}") as pws,
        ):
            await mws.send(json.dumps({"type": "auth", "token": master["token"]}))
            await pws.send(json.dumps({"type": "auth", "token": player["token"]}))

            async def until(ws, msg_type: str) -> dict:
                while True:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                    if msg["type"] == msg_type:
                        return msg

            await until(mws, "welcome")
            welcome = await until(pws, "welcome")
            assert welcome["table"]["scene"]["id"] == scene["id"], welcome["table"]
            assert {n["name"] for n in welcome["table"]["npcs"]} == {"Goblin"}
            assert "hp_current" not in welcome["table"]["npcs"][0]  # jogador só vê o estado do inimigo

            await mws.send(json.dumps({"type": "token.move", "token_id": tokens["goblin"]["id"], "x": 210, "y": 140}))
            moved = await until(pws, "token.moved")
            print(f"Jogadora viu o goblin andar para ({moved['x']}, {moved['y']})")

            await mws.send(json.dumps({"type": "hp.change", "npc_id": goblin["id"], "delta": 4, "kind": "damage"}))
            npc = await until(pws, "npc.upserted")
            print(f"Jogadora vê o goblin: {npc['npc']['condition_label']}")
            await pws.send(
                json.dumps(
                    {"type": "roll.request", "id": "smoke-1", "notation": "1d20+5", "character_id": character["id"]}
                )
            )
            roll = await until(mws, "roll.result")
            print(
                f"Mestre recebeu: {roll['summary']} → tier={roll['outcome']['tier']} anim={roll['outcome']['effect']['animation']}"
            )

            await pws.send(
                json.dumps({"type": "hp.change", "character_id": character["id"], "delta": 5, "kind": "damage"})
            )
            hit = await until(mws, "hp.changed")
            print(f"Mestre recebeu: {hit['summary']} → efeito={hit['effect']}")
            assert hit["hp_current"] == character["hp_max"] - 5

        events = (await http.get(f"/api/v1/rooms/{room['id']}/events", headers=hm)).json()
        types = [e["type"] for e in events]
        print("Log da sessão:", types)
        assert types == [
            "join",
            "hp_change",
            "dice_roll",
            "hp_change",
        ], types  # dano no goblin fica só no log do Mestre
        print("SMOKE TEST OK")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"))
