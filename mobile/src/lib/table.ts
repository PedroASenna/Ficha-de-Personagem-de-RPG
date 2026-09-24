/**
 * Mapa do jogador (só leitura): a cena onde está o boneco dele, com os bonecos visíveis.
 * Reducer puro dos eventos do WebSocket + geometria do mapa (enquadrar, converter toque, achar boneco).
 */
import type { PartyMember, PublicNpc, PublicWorld, Scene, SceneImage, SceneObject, ServerMessage, TableToken, TableView } from './types';

export type TableState = {
  role: 'player' | 'master' | null;
  scene: Scene | null;
  tokens: Record<string, TableToken>;
  npcs: Record<string, PublicNpc>;
  images: Record<string, SceneImage>;
  objects: Record<string, SceneObject>;
  /** O que o meu personagem explorou nesta cena (null = sem névoa). */
  fog: Uint8Array | null;
  party: PartyMember[];
  world: PublicWorld | null;
};

export const emptyTable: TableState = { role: null, scene: null, tokens: {}, npcs: {}, images: {}, objects: {}, fog: null, party: [], world: null };

// ---------- névoa ----------

export function decodeBits(base64: string): Uint8Array {
  const binary = atob(base64);
  const bits = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bits[i] = binary.charCodeAt(i);
  return bits;
}

export function isExplored(bits: Uint8Array, index: number): boolean {
  return ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
}

function withCells(bits: Uint8Array | null, cells: number[], length: number): Uint8Array {
  const next = new Uint8Array(Math.max(length, bits?.length ?? 0));
  if (bits) next.set(bits);
  for (const index of cells) {
    const byte = index >> 3;
    if (byte < next.length) next[byte] = (next[byte] ?? 0) | (1 << (index & 7));
  }
  return next;
}

/**
 * Caminho SVG cobrindo as células NÃO exploradas (preto para o jogador). Células vizinhas numa
 * mesma linha viram um retângulo só, para o desenho ficar leve mesmo em mapas grandes.
 */
export function fogPath(bits: Uint8Array, cols: number, rows: number, cell: number): string {
  const parts: string[] = [];
  for (let row = 0; row < rows; row++) {
    let start = -1;
    for (let col = 0; col <= cols; col++) {
      const hidden = col < cols && !isExplored(bits, row * cols + col);
      if (hidden && start < 0) start = col;
      if (!hidden && start >= 0) {
        const x = start * cell;
        const y = row * cell;
        // Um pouquinho de sobra evita frestas entre linhas vizinhas no antialias.
        parts.push(`M${x} ${y}h${(col - start) * cell + 0.5}v${cell + 0.5}h${-((col - start) * cell + 0.5)}z`);
        start = -1;
      }
    }
  }
  return parts.join('');
}

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
  const world = view.world ?? null;
  if (view.role === 'master') {
    // O Mestre usa o painel do PC; no celular ele vê a primeira cena, só para conferir.
    const scene = [...view.scenes].sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
    const inScene = <T extends { scene_id: string }>(items: T[] | undefined) => (items ?? []).filter((i) => i.scene_id === scene?.id);
    return {
      role: 'master',
      scene,
      tokens: indexBy(view.tokens.filter((t) => t.scene_id === scene?.id && !t.hidden)),
      npcs: indexBy(view.npcs),
      images: indexBy(inScene(view.images)),
      objects: indexBy(inScene(view.objects)),
      fog: null,
      party: view.party,
      world,
    };
  }
  return {
    role: 'player',
    scene: view.scene,
    tokens: indexBy(view.tokens),
    npcs: indexBy(view.npcs),
    images: indexBy(view.images ?? []),
    objects: indexBy(view.objects ?? []),
    fog: view.scene?.fog_enabled && view.fog ? decodeBits(view.fog.explored) : null,
    party: view.party,
    world,
  };
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
    case 'image.upserted':
      if (msg.image.scene_id !== state.scene?.id) return state;
      return { ...state, images: { ...state.images, [msg.image.id]: msg.image } };
    case 'image.deleted':
      return { ...state, images: without(state.images, msg.image_id) };
    case 'object.upserted': {
      if (msg.object.scene_id !== state.scene?.id) return state;
      let tokens = state.tokens;
      for (const moved of msg.tokens) {
        const token = tokens[moved.token_id];
        if (token && moved.version >= token.version) tokens = { ...tokens, [token.id]: { ...token, x: moved.x, y: moved.y, version: moved.version } };
      }
      return { ...state, tokens, objects: { ...state.objects, [msg.object.id]: msg.object } };
    }
    case 'object.deleted':
      return { ...state, objects: without(state.objects, msg.object_id) };
    case 'fog.revealed': {
      const scene = state.scene;
      if (!scene || msg.scene_id !== scene.id || !scene.fog_enabled) return state;
      return { ...state, fog: withCells(state.fog, msg.cells, Math.ceil((scene.fog_cols * scene.fog_rows) / 8)) };
    }
    case 'fog.reset': {
      const scene = state.scene;
      if (!scene || msg.scene_id !== scene.id || !scene.fog_enabled) return state;
      return { ...state, fog: new Uint8Array(Math.ceil((scene.fog_cols * scene.fog_rows) / 8)) };
    }
    case 'world.updated':
      return { ...state, world: msg.world };
    case 'character.leveled':
      return {
        ...state,
        party: state.party.map((p) =>
          p.id === msg.character.id
            ? { ...p, level: msg.level, hp_current: msg.hp_current, hp_max: msg.hp_max, hp_temp: msg.hp_temp, version: msg.version }
            : p,
        ),
      };
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

export function orderedImages(state: TableState): SceneImage[] {
  return Object.values(state.images).sort((a, b) => a.z - b.z);
}

export function orderedObjects(state: TableState): SceneObject[] {
  return Object.values(state.objects).sort((a, b) => a.z - b.z);
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
