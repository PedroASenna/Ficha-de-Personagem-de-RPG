// Estado da mesa virtual do Mestre, montado a partir do "welcome" e atualizado pelos eventos do WebSocket.
// Função pura: fácil de testar e de reaproveitar (o app dos jogadores tem um reducer irmão).

import type { MasterTable, Npc, PartyMember, Room, RollTier, Scene, SessionEvent, Token } from "../api/types";

export interface LogEntry {
  id: string;
  ts: string;
  kind: "roll" | "hp" | "join" | "system";
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
  | { type: "presence"; user_id: string; online: boolean }
  | { type: "party.updated"; party: PartyMember[] }
  | { type: "member.kicked"; user_id: string }
  | { type: "room.closed" }
  | { type: "local/token.position"; token_id: string; x: number; y: number };

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

function loadTable(state: TableState, table: MasterTable): TableState {
  return {
    ...state,
    scenes: [...table.scenes].sort(byOrder),
    tokens: indexBy(table.tokens),
    npcs: indexBy(table.npcs),
    party: table.party,
  };
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
    case "scene.deleted": {
      const tokens = Object.fromEntries(Object.entries(state.tokens).filter(([, t]) => t.scene_id !== action.scene_id));
      return { ...state, scenes: state.scenes.filter((s) => s.id !== action.scene_id), tokens };
    }
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

export function npcTokenCount(state: TableState): Record<string, number> {
  const result: Record<string, number> = {};
  for (const token of Object.values(state.tokens)) {
    if (token.npc_id) result[token.npc_id] = (result[token.npc_id] ?? 0) + 1;
  }
  return result;
}
