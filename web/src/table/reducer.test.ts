import { describe, expect, it } from "vitest";

import type { MasterTable, Npc, PartyMember, Room, Scene, Token } from "../api/types";
import { characterScenes, initialTableState, LOG_LIMIT, sceneTokens, type TableState, tableReducer } from "./reducer";

const scene = (id: string, sort_order: number, name = id): Scene => ({
  id,
  name,
  map_url: null,
  map_key: null,
  map_width: 1000,
  map_height: 800,
  grid_size: 50,
  grid_visible: true,
  sort_order,
});

const token = (id: string, scene_id: string, extra: Partial<Token> = {}): Token => ({
  id,
  scene_id,
  character_id: null,
  npc_id: null,
  x: 0,
  y: 0,
  size: 1,
  hidden: false,
  z: 0,
  version: 1,
  ...extra,
});

const goblin: Npc = {
  id: "gob",
  name: "Goblin 1",
  portrait_url: null,
  portrait_key: null,
  hp_max: 7,
  hp_current: 7,
  hp_temp: 0,
  armor_class: 15,
  attributes: { str: 8 },
  notes: "",
  version: 1,
  condition: "ileso",
  condition_label: "Ileso",
};

const lyra: PartyMember = {
  id: "lyra",
  owner_id: "user-ana",
  name: "Lyra",
  class_name: "Bruxa",
  ancestry_name: "Elfa",
  level: 1,
  portrait_url: null,
  hp_current: 10,
  hp_max: 10,
  hp_temp: 0,
  version: 1,
};

const room = {
  id: "room",
  pin: "ABC123",
  name: "Campanha",
  members: [{ user_id: "user-ana", display_name: "Ana", role: "player", online: true, character: null }],
} as unknown as Room;

const table: MasterTable = {
  role: "master",
  scenes: [scene("caverna", 1), scene("floresta", 0)],
  tokens: [
    token("t-lyra", "floresta", { character_id: "lyra", x: 25, y: 25 }),
    token("t-gob", "floresta", { npc_id: "gob", x: 75, y: 25, hidden: true }),
  ],
  npcs: [goblin],
  party: [lyra],
};

function loaded(): TableState {
  return tableReducer(initialTableState, { type: "welcome", room, log: [], table });
}

describe("tableReducer", () => {
  it("monta a mesa a partir do welcome, com cenas em ordem", () => {
    const state = loaded();
    expect(state.ready).toBe(true);
    expect(state.scenes.map((s) => s.id)).toEqual(["floresta", "caverna"]);
    expect(Object.keys(state.tokens)).toHaveLength(2);
    expect(state.online["user-ana"]).toBe(true);
    expect(characterScenes(state)).toEqual({ lyra: "floresta" });
  });

  it("aplica movimento e ignora eco atrasado", () => {
    let state = tableReducer(loaded(), { type: "token.moved", token_id: "t-lyra", x: 125, y: 75, version: 3 });
    expect(state.tokens["t-lyra"]).toMatchObject({ x: 125, y: 75, version: 3 });
    const stale = tableReducer(state, { type: "token.moved", token_id: "t-lyra", x: 0, y: 0, version: 2 });
    expect(stale).toBe(state);
    state = tableReducer(state, { type: "token.moved", token_id: "nao-existe", x: 1, y: 1, version: 9 });
    expect(state.tokens["t-lyra"].x).toBe(125);
  });

  it("move o personagem para outra cena (grupo se separou)", () => {
    const moved = token("t-lyra", "caverna", { character_id: "lyra", version: 2 });
    const state = tableReducer(loaded(), { type: "token.upserted", token: moved });
    expect(characterScenes(state)).toEqual({ lyra: "caverna" });
    expect(sceneTokens(state, "floresta").map((t) => t.id)).toEqual(["t-gob"]);
  });

  it("apagar cena remove os bonecos dela", () => {
    const state = tableReducer(loaded(), { type: "scene.deleted", scene_id: "floresta" });
    expect(state.scenes.map((s) => s.id)).toEqual(["caverna"]);
    expect(state.tokens).toEqual({});
  });

  it("apagar inimigo remove os bonecos dele", () => {
    const state = tableReducer(loaded(), { type: "npc.deleted", npc_id: "gob" });
    expect(state.npcs).toEqual({});
    expect(Object.keys(state.tokens)).toEqual(["t-lyra"]);
  });

  it("dano no inimigo atualiza os números e entra no log como secreto", () => {
    const state = tableReducer(loaded(), {
      type: "npc.hp.changed",
      event_id: 10,
      ts: "2026-09-23T20:00:00Z",
      npc_id: "gob",
      hp_current: 3,
      hp_max: 7,
      hp_temp: 0,
      version: 2,
      condition: "muito_ferido",
      condition_label: "Muito ferido",
      summary: "Goblin 1 sofreu 4 de dano (3/7 PV)",
    });
    expect(state.npcs.gob).toMatchObject({ hp_current: 3, condition: "muito_ferido" });
    expect(state.log).toEqual([expect.objectContaining({ id: "10", secret: true, kind: "hp" })]);
  });

  it("dano no personagem atualiza o grupo", () => {
    const state = tableReducer(loaded(), {
      type: "hp.changed",
      event_id: 11,
      ts: "2026-09-23T20:00:00Z",
      character: { id: "lyra", name: "Lyra" },
      hp_current: 4,
      hp_max: 10,
      hp_temp: 2,
      version: 5,
      summary: "Lyra sofreu 6 de dano",
    });
    expect(state.party[0]).toMatchObject({ hp_current: 4, hp_temp: 2, version: 5 });
  });

  it("rolagem vira a última rolagem e não duplica no log", () => {
    const roll = {
      type: "roll.result" as const,
      event_id: 12,
      ts: "2026-09-23T20:00:00Z",
      visibility: "master_only" as const,
      summary: "Goblin 1 rolou 1d20+4 = 24 — CRÍTICO!",
      roll: { total: 24 },
      outcome: { tier: "critical_success" as const },
    };
    let state = tableReducer(loaded(), roll);
    state = tableReducer(state, roll);
    expect(state.log).toHaveLength(1);
    expect(state.lastRoll).toMatchObject({ total: 24, tier: "critical_success", secret: true });
  });

  it("limita o tamanho do log", () => {
    let state = loaded();
    for (let i = 0; i < LOG_LIMIT + 5; i++) {
      state = tableReducer(state, {
        type: "roll.result",
        event_id: i,
        ts: "",
        visibility: "public",
        summary: `r${i}`,
        roll: { total: i },
        outcome: { tier: "neutral" },
      });
    }
    expect(state.log).toHaveLength(LOG_LIMIT);
    expect(state.log[0].id).toBe("5");
  });

  it("atualiza presença, grupo e arquivamento", () => {
    let state = tableReducer(loaded(), { type: "presence", user_id: "user-ana", online: false });
    expect(state.online["user-ana"]).toBe(false);
    state = tableReducer(state, { type: "party.updated", party: [lyra, { ...lyra, id: "beto", name: "Beto" }] });
    expect(state.party.map((p) => p.name)).toEqual(["Lyra", "Beto"]);
    state = tableReducer(state, { type: "room.closed" });
    expect(state.room?.status).toBe("closed");
  });

  it("ordena bonecos: z maior por cima, personagens sobre inimigos no empate", () => {
    const state = tableReducer(loaded(), {
      type: "token.upserted",
      token: token("t-top", "floresta", { npc_id: "gob", z: 5 }),
    });
    expect(sceneTokens(state, "floresta").map((t) => t.id)).toEqual(["t-gob", "t-lyra", "t-top"]);
  });
});
