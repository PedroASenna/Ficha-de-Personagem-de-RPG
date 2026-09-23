import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SceneView } from '../src/components/table/SceneView';
import type { PartyMember, PublicNpc, Scene, TableToken } from '../src/lib/types';
import { useServer } from '../src/state/server';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const scene: Scene = {
  id: 's',
  name: 'Floresta',
  map_url: '/media/rooms/r/map/mapa.jpg',
  map_width: 1000,
  map_height: 500,
  grid_size: 50,
  grid_visible: true,
  sort_order: 0,
};
const tokens: TableToken[] = [
  { id: 't1', scene_id: 's', character_id: 'lyra', npc_id: null, x: 75, y: 75, size: 1, hidden: false, z: 0, version: 1 },
  { id: 't2', scene_id: 's', character_id: null, npc_id: 'gob', x: 175, y: 75, size: 2, hidden: false, z: 0, version: 1 },
];
const npcs: Record<string, PublicNpc> = {
  gob: { id: 'gob', name: 'Goblin 1', portrait_url: null, condition: 'caido', condition_label: 'Caído' },
};
const party: PartyMember[] = [
  {
    id: 'lyra',
    owner_id: 'ana',
    name: 'Lyra',
    class_name: 'Bruxa',
    ancestry_name: null,
    level: 1,
    portrait_url: '/media/portraits/lyra.jpg',
    hp_current: 10,
    hp_max: 10,
    hp_temp: 0,
    version: 1,
  },
];

describe('<SceneView />', () => {
  beforeEach(() => {
    useServer.setState({
      server: { url: 'http://192.168.0.20:8080', name: 'Casa', version: '0.2.0', serverId: 'x', registrationOpen: true },
    });
  });

  it('desenha mapa e bonecos do servidor da casa depois de medir a tela', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<SceneView scene={scene} tokens={tokens} npcs={npcs} party={party} myCharacterId="lyra" onSelect={() => undefined} />);
    });
    const root = tree.root.find((n) => n.props.testID === 'scene-view');
    // Antes de medir a área, nada de mapa (evita desenhar com tamanho zero).
    expect(tree.root.findAll((n) => n.props.href !== undefined)).toHaveLength(0);
    act(() => root.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 400 } } }));

    const images = tree.root.findAll((n) => n.props.href?.uri !== undefined).map((n) => n.props.href.uri as string);
    expect(images).toContain('http://192.168.0.20:8080/media/rooms/r/map/mapa.jpg');
    expect(images).toContain('http://192.168.0.20:8080/media/portraits/lyra.jpg');
    const labels = tree.root.findAll((n) => typeof n.props.children === 'string').map((n) => n.props.children as string);
    expect(labels).toEqual(expect.arrayContaining(['Lyra', 'Goblin 1', 'G1']));
    // Inimigo caído aparece apagado.
    const faded = tree.root.findAll((n) => n.props.opacity === 0.55);
    expect(faded.length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });
});
