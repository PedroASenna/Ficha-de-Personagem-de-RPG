"""Smoke test ponta a ponta contra uma API rodando (local ou staging).

    python scripts/smoke_test.py http://localhost:8080

Cria Mestre e jogadora, abre sala (SRD 5.1), entra pelo PIN, rola 1d20+5 e aplica dano pelo WebSocket,
e confere que o Mestre recebeu tudo e que o log da sessão registrou os eventos.
"""

import asyncio
import json
import sys
import uuid

import httpx
import websockets


async def main(base: str) -> None:
    ws_base = base.replace("http", "ws", 1)
    async with httpx.AsyncClient(base_url=base, timeout=10) as http:

        async def register(name: str) -> dict:
            r = await http.post(
                "/api/v1/auth/register",
                json={
                    "email": f"{name.lower()}-{uuid.uuid4().hex[:8]}@example.com",
                    "password": "senha-do-smoke-test",
                    "display_name": name,
                    "age_confirmed": True,
                    "accept_terms": True,
                },
            )
            r.raise_for_status()
            return {"Authorization": f"Bearer {r.json()['access_token']}", "token": r.json()["access_token"]}

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
            await until(pws, "welcome")
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
        assert types == ["join", "dice_roll", "hp_change"], types
        print("SMOKE TEST OK")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"))
