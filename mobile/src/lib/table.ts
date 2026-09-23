/**
 * Mapa do jogador (só leitura): a cena onde está o boneco dele, com os bonecos visíveis.
 * Reducer puro dos eventos do WebSocket + geometria do mapa (enquadrar, converter toque, achar boneco).
 */
import type { PartyMember, PublicNpc, Scene, ServerMessage, TableToken, TableView } from './types';

export type TableState = {
  role: 'player' | 'master' | null;
  scene: Scene | null;
  tokens: Record<string, TableToken>;
  npcs: Record<string, PublicNpc>;
  party: PartyMember[];
};

export const emptyTable: TableState = { role: null, scene: null, tokens: {}, npcs: {}, party: [] };

function indexBy<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export function fromView(view: TableView): TableState {
  if (view.role === 'master') {
    // O Mestre usa o painel do PC; no celular ele vê a primeira cena, só para conferir.
    const scene = [...view.scenes].sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
    return {
      role: 'master',
      scene,
      tokens: indexBy(view.tokens.filter((t) => t.scene_id === scene?.id && !t.hidden)),
      npcs: indexBy(view.npcs),
      party: view.party,
    };
  }
  return { role: 'player', scene: view.scene, tokens: indexBy(view.tokens), npcs: indexBy(view.npcs), party: view.party };
}

export function tableReducer(state: TableState, msg: ServerMessage): TableState {
  switch (msg.type) {
    case 'welcome':
      return fromView(msg.table);
    case 'view.reset':
      return fromView(msg.table);
    case 'scene.upserted':
      return state.scene?.id === msg.scene.id ? { ...state, scene: msg.scene } : state;
    case 'token.upserted': {
      const npcs = msg.npc ? { ...state.npcs, [msg.npc.id]: msg.npc } : state.npcs;
      if (msg.token.scene_id !== state.scene?.id || msg.token.hidden) {
        return { ...state, npcs, tokens: without(state.tokens, msg.token.id) };
      }
      return { ...state, npcs, tokens: { ...state.tokens, [msg.token.id]: msg.token } };
    }
    case 'token.moved': {
      const token = state.tokens[msg.token_id];
      if (!token || msg.version < token.version) return state;
      return { ...state, tokens: { ...state.tokens, [token.id]: { ...token, x: msg.x, y: msg.y, version: msg.version } } };
    }
    case 'token.deleted':
      return { ...state, tokens: without(state.tokens, msg.token_id) };
    case 'npc.upserted':
      return { ...state, npcs: { ...state.npcs, [msg.npc.id]: msg.npc } };
    case 'npc.deleted': {
      const tokens = Object.fromEntries(Object.entries(state.tokens).filter(([, t]) => t.npc_id !== msg.npc_id));
      return { ...state, tokens, npcs: without(state.npcs, msg.npc_id) };
    }
    case 'party.updated':
      return { ...state, party: msg.party };
    case 'hp.changed':
      return {
        ...state,
        party: state.party.map((p) =>
          p.id === msg.character_id ? { ...p, hp_current: msg.hp_current, hp_max: msg.hp_max, hp_temp: msg.hp_temp, version: msg.version } : p,
        ),
      };
    default:
      return state;
  }
}

/** Bonecos de baixo para cima (maior z por cima; personagens por cima de inimigos no empate). */
export function orderedTokens(state: TableState): TableToken[] {
  return Object.values(state.tokens).sort(
    (a, b) => a.z - b.z || Number(a.character_id !== null) - Number(b.character_id !== null),
  );
}

// ---------- geometria ----------

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Transform = { tx: number; ty: number; scale: number };

/** Escala para o mapa inteiro caber na área (o "zoom 1"). */
export function fitScale(map: Size, area: Size): number {
  if (map.width <= 0 || map.height <= 0 || area.width <= 0 || area.height <= 0) return 1;
  return Math.min(area.width / map.width, area.height / map.height);
}

/**
 * Toque na tela → ponto do mapa. O mapa enquadrado fica centralizado na área e o gesto aplica
 * translate(tx, ty) e depois scale em torno do centro dele.
 */
export function screenToMap(point: Point, map: Size, area: Size, transform: Transform): Point {
  const base = fitScale(map, area);
  const cw = map.width * base;
  const ch = map.height * base;
  const cx = area.width / 2;
  const cy = area.height / 2;
  const qx = (point.x - cx - transform.tx) / transform.scale + cw / 2;
  const qy = (point.y - cy - transform.ty) / transform.scale + ch / 2;
  return { x: qx / base, y: qy / base };
}

export function tokenRadius(size: number, grid: number): number {
  return (size * grid * 0.92) / 2;
}

/** Boneco sob o ponto (o de cima, se houver vários); com uma folga para dedos. */
export function tokenAt(point: Point, tokens: TableToken[], grid: number, slop = 0.15): TableToken | null {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i] as TableToken;
    const r = tokenRadius(token.size, grid) * (1 + slop);
    if ((point.x - token.x) ** 2 + (point.y - token.y) ** 2 <= r * r) return token;
  }
  return null;
}

/** Linhas da grade num único caminho SVG. */
export function gridPath(width: number, height: number, grid: number): string {
  if (grid < 4) return '';
  const parts: string[] = [];
  for (let x = grid; x < width; x += grid) parts.push(`M${x} 0V${height}`);
  for (let y = grid; y < height; y += grid) parts.push(`M0 ${y}H${width}`);
  return parts.join('');
}
