// Estado da mesa virtual do Mestre, montado a partir do "welcome" e atualizado pelos eventos do WebSocket.
// Função pura: fácil de testar e de reaproveitar (o app dos jogadores tem um reducer irmão).

import type {
  MasterTable,
  Npc,
  PartyMember,
  Room,
  RollTier,
  Scene,
  SceneImage,
  SceneObject,
  SessionEvent,
  Token,
  World,
} from "../api/types";
import { byteLength, decodeBits, withCells } from "./fog";

export interface LogEntry {
  id: string;
  ts: string;
  kind: "roll" | "hp" | "join" | "level" | "system";
  text: string;
  secret: boolean;
  tier?: RollTier;
  total?: number;
}

export interface TableState {
  ready: boolean;
  room: Room | null;
  scenes: Scene[];
  tokens: Record<string, Token>;
  npcs: Record<string, Npc>;
  images: Record<string, SceneImage>;
  objects: Record<string, SceneObject>;
  // Névoa: cena → personagem → bits explorados.
  fog: Record<string, Record<string, Uint8Array>>;
  world: World | null;
  party: PartyMember[];
  online: Record<string, boolean>;
  log: LogEntry[];
  lastRoll: LogEntry | null;
}

export const initialTableState: TableState = {
  ready: false,
  room: null,
  scenes: [],
  tokens: {},
  npcs: {},
  images: {},
  objects: {},
  fog: {},
  world: null,
  party: [],
  online: {},
  log: [],
  lastRoll: null,
};

export const LOG_LIMIT = 200;

// Mensagens do servidor (backend/app/ws/protocol.py) e ações locais da interface.
export type TableAction =
  | { type: "welcome"; room: Room; log: SessionEvent[]; table: MasterTable }
  | { type: "view.reset"; table: MasterTable }
  | { type: "scene.upserted"; scene: Scene }
  | { type: "scene.deleted"; scene_id: string }
  | { type: "token.upserted"; token: Token }
  | { type: "token.moved"; token_id: string; x: number; y: number; version: number }
  | { type: "token.deleted"; token_id: string }
  | { type: "npc.upserted"; npc: Npc }
  | { type: "npc.deleted"; npc_id: string }
  | {
      type: "npc.hp.changed";
      event_id: number;
      ts: string;
      npc_id: string;
      hp_current: number;
      hp_max: number;
      hp_temp: number;
      version: number;
      condition: Npc["condition"];
      condition_label: string;
      summary: string;
    }
  | {
      type: "hp.changed";
      event_id: number;
      ts: string;
      character: { id: string; name: string };
      hp_current: number;
      hp_max: number;
      hp_temp: number;
      version: number;
      summary: string;
    }
  | {
      type: "roll.result";
      event_id: number;
      ts: string;
      visibility: "public" | "master_only";
      summary: string;
      roll: { total: number };
      outcome: { tier: RollTier };
    }
  | { type: "image.upserted"; image: SceneImage }
  | { type: "image.deleted"; image_id: string }
  | {
      type: "object.upserted";
      object: SceneObject;
      tokens: { token_id: string; x: number; y: number; version: number }[];
    }
  | { type: "object.deleted"; object_id: string }
  | { type: "fog.revealed"; scene_id: string; character_id: string; cells: number[] }
  | { type: "fog.reset"; scene_id: string; character_id: string | null }
  | { type: "world.updated"; world: World }
  | {
      type: "character.leveled";
      event_id: number;
      ts: string;
      character: { id: string; name: string };
      level: number;
      hp_current: number;
      hp_max: number;
      hp_temp: number;
      version: number;
      summary: string;
    }
  | { type: "presence"; user_id: string; online: boolean }
  | { type: "party.updated"; party: PartyMember[] }
  | { type: "member.kicked"; user_id: string }
  | { type: "room.closed" }
  | { type: "local/token.position"; token_id: string; x: number; y: number }
  | { type: "local/object.position"; object_id: string; x: number; y: number };

function byOrder(a: Scene, b: Scene): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

function indexBy<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function appendLog(state: TableState, entry: LogEntry): LogEntry[] {
  if (state.log.some((e) => e.id === entry.id)) return state.log;
  const log = [...state.log, entry];
  return log.length > LOG_LIMIT ? log.slice(log.length - LOG_LIMIT) : log;
}

/** Evento gravado no log (welcome) → linha do log do painel. */
export function eventToLog(event: SessionEvent): LogEntry {
  const payload = event.payload;
  const kind: LogEntry["kind"] =
    event.type === "dice_roll"
      ? "roll"
      : event.type === "hp_change" || event.type === "rest"
        ? "hp"
        : event.type === "join"
          ? "join"
          : event.type === "level_up"
            ? "level"
            : "system";
  const outcome = payload.outcome as { tier?: RollTier } | undefined;
  const roll = payload.roll as { total?: number } | undefined;
  return {
    id: String(event.id),
    ts: event.created_at,
    kind,
    text: typeof payload.summary === "string" ? payload.summary : event.type,
    secret: event.visibility === "master_only",
    tier: outcome?.tier,
    total: roll?.total,
  };
}

function loadFog(entries: MasterTable["fog"]): TableState["fog"] {
  const fog: TableState["fog"] = {};
  for (const entry of entries) {
    fog[entry.scene_id] = { ...fog[entry.scene_id], [entry.character_id]: decodeBits(entry.explored) };
  }
  return fog;
}

function loadTable(state: TableState, table: MasterTable): TableState {
  return {
    ...state,
    scenes: [...table.scenes].sort(byOrder),
    tokens: indexBy(table.tokens),
    npcs: indexBy(table.npcs),
    images: indexBy(table.images ?? []),
    objects: indexBy(table.objects ?? []),
    fog: loadFog(table.fog ?? []),
    world: table.world ?? null,
    party: table.party,
  };
}

function withoutScene<T extends { scene_id: string }>(record: Record<string, T>, sceneId: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([, item]) => item.scene_id !== sceneId));
}

export function tableReducer(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case "welcome": {
      const online = Object.fromEntries(action.room.members.map((m) => [m.user_id, m.online]));
      const log = action.log.map(eventToLog);
      return { ...loadTable(state, action.table), ready: true, room: action.room, online, log, lastRoll: null };
    }
    case "view.reset":
      return action.table.role === "master" ? loadTable(state, action.table) : state;
    case "scene.upserted": {
      const others = state.scenes.filter((s) => s.id !== action.scene.id);
      return { ...state, scenes: [...others, action.scene].sort(byOrder) };
    }
    case "scene.deleted":
      return {
        ...state,
        scenes: state.scenes.filter((s) => s.id !== action.scene_id),
        tokens: withoutScene(state.tokens, action.scene_id),
        images: withoutScene(state.images, action.scene_id),
        objects: withoutScene(state.objects, action.scene_id),
        fog: withoutKey(state.fog, action.scene_id),
      };
    case "token.upserted":
      return { ...state, tokens: { ...state.tokens, [action.token.id]: action.token } };
    case "token.moved": {
      const token = state.tokens[action.token_id];
      if (!token || action.version < token.version) return state;
      return {
        ...state,
        tokens: { ...state.tokens, [token.id]: { ...token, x: action.x, y: action.y, version: action.version } },
      };
    }
    case "local/token.position": {
      const token = state.tokens[action.token_id];
      if (!token) return state;
      return { ...state, tokens: { ...state.tokens, [token.id]: { ...token, x: action.x, y: action.y } } };
    }
    case "token.deleted":
      return { ...state, tokens: withoutKey(state.tokens, action.token_id) };
    case "image.upserted": {
      const current = state.images[action.image.id];
      if (current && action.image.version < current.version) return state;
      return { ...state, images: { ...state.images, [action.image.id]: action.image } };
    }
    case "image.deleted":
      return { ...state, images: withoutKey(state.images, action.image_id) };
    case "object.upserted": {
      const current = state.objects[action.object.id];
      const objects =
        current && action.object.version < current.version
          ? state.objects
          : { ...state.objects, [action.object.id]: action.object };
      let tokens = state.tokens;
      for (const moved of action.tokens) {
        const token = tokens[moved.token_id];
        if (token && moved.version >= token.version) {
          tokens = { ...tokens, [token.id]: { ...token, x: moved.x, y: moved.y, version: moved.version } };
        }
      }
      return objects === state.objects && tokens === state.tokens ? state : { ...state, objects, tokens };
    }
    case "local/object.position": {
      const obj = state.objects[action.object_id];
      if (!obj) return state;
      const dx = action.x - obj.x;
      const dy = action.y - obj.y;
      const tokens = { ...state.tokens };
      for (const token of Object.values(state.tokens)) {
        if (token.container_id === obj.id) tokens[token.id] = { ...token, x: token.x + dx, y: token.y + dy };
      }
      return { ...state, tokens, objects: { ...state.objects, [obj.id]: { ...obj, x: action.x, y: action.y } } };
    }
    case "object.deleted": {
      const tokens = { ...state.tokens };
      for (const token of Object.values(state.tokens)) {
        if (token.container_id === action.object_id) tokens[token.id] = { ...token, container_id: null };
      }
      return { ...state, tokens, objects: withoutKey(state.objects, action.object_id) };
    }
    case "fog.revealed": {
      const scene = state.scenes.find((s) => s.id === action.scene_id);
      if (!scene) return state;
      const sceneFog = state.fog[action.scene_id] ?? {};
      const bits = withCells(sceneFog[action.character_id], action.cells, byteLength(scene));
      return { ...state, fog: { ...state.fog, [action.scene_id]: { ...sceneFog, [action.character_id]: bits } } };
    }
    case "fog.reset": {
      if (action.character_id === null) return { ...state, fog: withoutKey(state.fog, action.scene_id) };
      const sceneFog = state.fog[action.scene_id];
      if (!sceneFog) return state;
      return { ...state, fog: { ...state.fog, [action.scene_id]: withoutKey(sceneFog, action.character_id) } };
    }
    case "world.updated":
      return { ...state, world: action.world };
    case "character.leveled": {
      const party = state.party.map((p) =>
        p.id === action.character.id
          ? {
              ...p,
              level: action.level,
              hp_current: action.hp_current,
              hp_max: action.hp_max,
              hp_temp: action.hp_temp,
              version: action.version,
            }
          : p,
      );
      const entry: LogEntry = {
        id: String(action.event_id),
        ts: action.ts,
        kind: "level",
        text: action.summary,
        secret: false,
      };
      return { ...state, party, log: appendLog(state, entry) };
    }
    case "npc.upserted":
      return { ...state, npcs: { ...state.npcs, [action.npc.id]: action.npc } };
    case "npc.deleted": {
      const tokens = Object.fromEntries(Object.entries(state.tokens).filter(([, t]) => t.npc_id !== action.npc_id));
      return { ...state, npcs: withoutKey(state.npcs, action.npc_id), tokens };
    }
    case "npc.hp.changed": {
      const npc = state.npcs[action.npc_id];
      const entry: LogEntry = {
        id: String(action.event_id),
        ts: action.ts,
        kind: "hp",
        text: action.summary,
        secret: true,
      };
      const npcs = npc
        ? {
            ...state.npcs,
            [npc.id]: {
              ...npc,
              hp_current: action.hp_current,
              hp_max: action.hp_max,
              hp_temp: action.hp_temp,
              version: action.version,
              condition: action.condition,
              condition_label: action.condition_label,
            },
          }
        : state.npcs;
      return { ...state, npcs, log: appendLog(state, entry) };
    }
    case "hp.changed": {
      const party = state.party.map((p) =>
        p.id === action.character.id
          ? {
              ...p,
              hp_current: action.hp_current,
              hp_max: action.hp_max,
              hp_temp: action.hp_temp,
              version: action.version,
            }
          : p,
      );
      const entry: LogEntry = {
        id: String(action.event_id),
        ts: action.ts,
        kind: "hp",
        text: action.summary,
        secret: false,
      };
      return { ...state, party, log: appendLog(state, entry) };
    }
    case "roll.result": {
      const entry: LogEntry = {
        id: String(action.event_id),
        ts: action.ts,
        kind: "roll",
        text: action.summary,
        secret: action.visibility === "master_only",
        tier: action.outcome.tier,
        total: action.roll.total,
      };
      return { ...state, log: appendLog(state, entry), lastRoll: entry };
    }
    case "presence":
      return { ...state, online: { ...state.online, [action.user_id]: action.online } };
    case "party.updated":
      return { ...state, party: action.party };
    case "member.kicked":
      return { ...state, online: withoutKey(state.online, action.user_id) };
    case "room.closed":
      return state.room ? { ...state, room: { ...state.room, status: "closed" } } : state;
    default:
      return state;
  }
}

// ---------- seletores ----------

export function sceneTokens(state: TableState, sceneId: string | null): Token[] {
  if (!sceneId) return [];
  return Object.values(state.tokens)
    .filter((t) => t.scene_id === sceneId)
    .sort((a, b) => a.z - b.z || Number(a.character_id !== null) - Number(b.character_id !== null));
}

/** Em que cena está cada personagem do grupo (para a lista lateral e as abas). */
export function characterScenes(state: TableState): Record<string, string> {
  const result: Record<string, string> = {};
  for (const token of Object.values(state.tokens)) {
    if (token.character_id) result[token.character_id] = token.scene_id;
  }
  return result;
}

/** Peças de cenário da cena, de baixo para cima. */
export function sceneImages(state: TableState, sceneId: string | null): SceneImage[] {
  if (!sceneId) return [];
  return Object.values(state.images)
    .filter((i) => i.scene_id === sceneId)
    .sort((a, b) => a.z - b.z);
}

export function sceneObjects(state: TableState, sceneId: string | null): SceneObject[] {
  if (!sceneId) return [];
  return Object.values(state.objects)
    .filter((o) => o.scene_id === sceneId)
    .sort((a, b) => a.z - b.z);
}

export function npcTokenCount(state: TableState): Record<string, number> {
  const result: Record<string, number> = {};
  for (const token of Object.values(state.tokens)) {
    if (token.npc_id) result[token.npc_id] = (result[token.npc_id] ?? 0) + 1;
  }
  return result;
}
