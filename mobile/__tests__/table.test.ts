import {
  decodeBits,
  emptyTable,
  fitScale,
  fogPath,
  fromView,
  gridPath,
  isExplored,
  orderedImages,
  orderedTokens,
  screenToMap,
  tableReducer,
  tokenAt,
} from '../src/lib/table';
import type { PartyMember, PublicNpc, Scene, ServerMessage, TableToken, TableView } from '../src/lib/types';

const base = { v: 1, ts: '2026-09-23T20:00:00Z' };

const floresta: Scene = {
  id: 'floresta',
  name: 'Floresta',
  map_url: '/media/rooms/r/map/x.jpg',
  map_width: 1000,
  map_height: 500,
  grid_size: 50,
  grid_visible: true,
  sort_order: 0,
  fog_enabled: false,
  fog_radius: 4,
  fog_cols: 40,
  fog_rows: 20,
  fog_cell: 25,
};

const token = (id: string, extra: Partial<TableToken> = {}): TableToken => ({
  id,
  scene_id: 'floresta',
  character_id: null,
  npc_id: null,
  x: 75,
  y: 75,
  size: 1,
  hidden: false,
  z: 0,
  rotation: 0,
  container_id: null,
  version: 1,
  ...extra,
});

const goblin: PublicNpc = { id: 'gob', name: 'Goblin 1', portrait_url: null, condition: 'ileso', condition_label: 'Ileso' };
const lyra: PartyMember = {
  id: 'lyra',
  owner_id: 'ana',
  name: 'Lyra',
  class_name: 'Bruxa',
  ancestry_name: 'Elfa',
  level: 1,
  portrait_url: null,
  hp_current: 10,
  hp_max: 10,
  hp_temp: 0,
  version: 1,
};

const playerView: TableView = {
  role: 'player',
  scene: floresta,
  tokens: [token('t-lyra', { character_id: 'lyra' }), token('t-gob', { npc_id: 'gob', x: 175 })],
  npcs: [goblin],
  party: [lyra],
};

const loaded = () => tableReducer(emptyTable, { ...base, type: 'view.reset', table: playerView } as ServerMessage);

describe('mapa do jogador', () => {
  it('monta a cena do jogador', () => {
    const state = loaded();
    expect(state.role).toBe('player');
    expect(state.scene?.name).toBe('Floresta');
    expect(Object.keys(state.tokens)).toEqual(['t-lyra', 't-gob']);
  });

  it('acompanha o Mestre movendo e ignora eco atrasado', () => {
    let state = tableReducer(loaded(), { ...base, type: 'token.moved', token_id: 't-gob', x: 300, y: 200, version: 3 });
    expect(state.tokens['t-gob']).toMatchObject({ x: 300, y: 200 });
    state = tableReducer(state, { ...base, type: 'token.moved', token_id: 't-gob', x: 0, y: 0, version: 2 });
    expect(state.tokens['t-gob']?.x).toBe(300);
  });

  it('boneco que vai para outra cena ou é escondido some do mapa', () => {
    let state = tableReducer(loaded(), { ...base, type: 'token.upserted', token: token('t-gob', { npc_id: 'gob', scene_id: 'caverna' }) });
    expect(state.tokens['t-gob']).toBeUndefined();
    state = tableReducer(state, { ...base, type: 'token.upserted', token: token('t-lyra', { character_id: 'lyra', hidden: true }) });
    expect(state.tokens).toEqual({});
  });

  it('inimigo revelado chega com o formato público', () => {
    const orc: PublicNpc = { id: 'orc', name: 'Orc', portrait_url: null, condition: 'ferido', condition_label: 'Ferido' };
    const state = tableReducer(loaded(), { ...base, type: 'token.upserted', token: token('t-orc', { npc_id: 'orc' }), npc: orc });
    expect(state.npcs.orc).toEqual(orc);
    expect(state.tokens['t-orc']).toBeDefined();
  });

  it('atualiza o estado do inimigo e o PV do grupo', () => {
    let state = tableReducer(loaded(), { ...base, type: 'npc.upserted', npc: { ...goblin, condition: 'muito_ferido', condition_label: 'Muito ferido' } });
    expect(state.npcs.gob?.condition).toBe('muito_ferido');
    state = tableReducer(state, {
      ...base,
      type: 'hp.changed',
      event_id: 1,
      character_id: 'lyra',
      kind: 'damage',
      delta: 4,
      hp_before: 10,
      hp_current: 6,
      hp_max: 10,
      hp_temp: 0,
      absorbed_by_temp: 0,
      effect: 'bleed',
      version: 2,
    } as ServerMessage);
    expect(state.party[0]).toMatchObject({ hp_current: 6, version: 2 });
  });

  it('inimigo apagado leva junto os bonecos dele', () => {
    const state = tableReducer(loaded(), { ...base, type: 'npc.deleted', npc_id: 'gob' });
    expect(Object.keys(state.tokens)).toEqual(['t-lyra']);
  });

  it('no celular do Mestre mostra a primeira cena sem os escondidos', () => {
    const state = fromView({
      role: 'master',
      scenes: [{ ...floresta, id: 'b', sort_order: 1 }, floresta],
      tokens: [token('t1'), token('t2', { hidden: true })],
      npcs: [],
      party: [],
    });
    expect(state.scene?.id).toBe('floresta');
    expect(Object.keys(state.tokens)).toEqual(['t1']);
  });

  it('personagens ficam por cima de inimigos no mesmo z', () => {
    expect(orderedTokens(loaded()).map((t) => t.id)).toEqual(['t-gob', 't-lyra']);
  });
});

describe('geometria do mapa', () => {
  const map = { width: 1000, height: 500 };
  const area = { width: 400, height: 400 };

  it('enquadra o mapa na tela', () => {
    expect(fitScale(map, area)).toBeCloseTo(0.4);
    expect(fitScale(map, { width: 0, height: 0 })).toBe(1);
  });

  it('converte o toque em ponto do mapa (com zoom e arrasto)', () => {
    expect(screenToMap({ x: 200, y: 200 }, map, area, { tx: 0, ty: 0, scale: 1 })).toEqual({ x: 500, y: 250 });
    expect(screenToMap({ x: 0, y: 100 }, map, area, { tx: 0, ty: 0, scale: 1 })).toEqual({ x: 0, y: 0 });
    // Zoom 2x no centro: o ponto que era o canto do mapa agora mostra (250, 125).
    const zoomed = screenToMap({ x: 0, y: 100 }, map, area, { tx: 0, ty: 0, scale: 2 });
    expect(zoomed.x).toBeCloseTo(250);
    expect(zoomed.y).toBeCloseTo(125);
    // Arrastar 40 px para a direita desloca 100 px do mapa (escala 0,4).
    expect(screenToMap({ x: 240, y: 200 }, map, area, { tx: 40, ty: 0, scale: 1 })).toEqual({ x: 500, y: 250 });
  });

  it('acha o boneco tocado (o de cima primeiro)', () => {
    const tokens = [token('baixo', { x: 100, y: 100 }), token('cima', { x: 110, y: 100 })];
    expect(tokenAt({ x: 108, y: 100 }, tokens, 50)?.id).toBe('cima');
    expect(tokenAt({ x: 75, y: 100 }, tokens, 50)?.id).toBe('baixo');
    expect(tokenAt({ x: 400, y: 400 }, tokens, 50)).toBeNull();
  });

  it('desenha a grade num caminho só', () => {
    expect(gridPath(150, 100, 50)).toBe('M50 0V100M100 0V100M0 50H150');
    expect(gridPath(150, 100, 2)).toBe('');
  });
});


describe('cenário, objetos, névoa e mundo', () => {
  const msg = (m: object) => ({ ...base, ...m }) as ServerMessage;

  it('peças de cenário da minha cena, em ordem de empilhamento', () => {
    let state = loaded();
    const piece = { id: 'p1', scene_id: 'floresta', url: '/media/p1.png', x: 10, y: 10, width: 50, height: 80, rotation: 45, z: 2, version: 1 };
    state = tableReducer(state, msg({ type: 'image.upserted', image: piece }));
    state = tableReducer(state, msg({ type: 'image.upserted', image: { ...piece, id: 'p0', z: 1 } }));
    state = tableReducer(state, msg({ type: 'image.upserted', image: { ...piece, id: 'outra', scene_id: 'caverna' } }));
    expect(orderedImages(state).map((p) => p.id)).toEqual(['p0', 'p1']);
    state = tableReducer(state, msg({ type: 'image.deleted', image_id: 'p0' }));
    expect(Object.keys(state.images)).toEqual(['p1']);
  });

  it('objeto andando leva os bonecos que eu vejo dentro', () => {
    const cart = { id: 'cart', scene_id: 'floresta', name: 'Carroça', url: null, x: 100, y: 100, width: 140, height: 90, rotation: 0, z: 0, hide_occupants: false, version: 2 };
    const state = tableReducer(loaded(), msg({ type: 'object.upserted', object: cart, tokens: [{ token_id: 't-lyra', x: 300, y: 90, version: 5 }] }));
    expect(state.objects.cart?.name).toBe('Carroça');
    expect(state.tokens['t-lyra']).toMatchObject({ x: 300, y: 90, version: 5 });
    expect(tableReducer(state, msg({ type: 'object.deleted', object_id: 'cart' })).objects).toEqual({});
  });

  it('névoa: só a do meu personagem, com células novas e cobrir de novo', () => {
    const fogged: TableView = {
      ...playerView,
      scene: { ...floresta, fog_enabled: true },
      fog: { scene_id: 'floresta', character_id: 'lyra', explored: btoa(String.fromCharCode(0b11)) },
    };
    let state = tableReducer(emptyTable, msg({ type: 'view.reset', table: fogged }));
    expect(state.fog && [0, 1, 2].map((i) => isExplored(state.fog!, i))).toEqual([true, true, false]);
    state = tableReducer(state, msg({ type: 'fog.revealed', scene_id: 'floresta', character_id: 'lyra', cells: [2, 799] }));
    expect(isExplored(state.fog!, 2) && isExplored(state.fog!, 799)).toBe(true);
    expect(state.fog).toHaveLength(100); // 40 × 20 células
    state = tableReducer(state, msg({ type: 'fog.reset', scene_id: 'floresta', character_id: 'lyra' }));
    expect(Array.from(state.fog!).every((b) => b === 0)).toBe(true);
    // Cena sem névoa: nada de dados.
    expect(tableReducer(emptyTable, msg({ type: 'view.reset', table: { ...fogged, scene: floresta } })).fog).toBeNull();
  });

  it('caminho da névoa junta células vizinhas da mesma linha', () => {
    const bits = decodeBits(btoa(String.fromCharCode(0b0110)));
    // 4 colunas × 1 linha: exploradas 1 e 2 → escuro na 0 e na 3.
    expect(fogPath(bits, 4, 1, 10)).toBe('M0 0h10.5v10.5h-10.5zM30 0h10.5v10.5h-10.5z');
    expect(fogPath(new Uint8Array(1), 4, 1, 10)).toBe('M0 0h40.5v10.5h-40.5z');
  });

  it('mundo e nível chegam pelo WebSocket', () => {
    const world = { map_url: '/media/mundo.jpg', map_width: 800, map_height: 500, visible: true, factions: [], relations: [] };
    let state = tableReducer(loaded(), msg({ type: 'world.updated', world }));
    expect(state.world?.map_url).toBe('/media/mundo.jpg');
    state = tableReducer(
      state,
      msg({ type: 'character.leveled', event_id: 3, character: { id: 'lyra', name: 'Lyra' }, level: 2, hp_gain: 6, hp_current: 16, hp_max: 16, hp_temp: 0, version: 4, summary: '' }),
    );
    expect(state.party[0]).toMatchObject({ level: 2, hp_max: 16 });
  });
});
