import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { WorldView } from '../src/components/table/WorldView';
import type { PublicWorld } from '../src/lib/types';
import { useServer } from '../src/state/server';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const world: PublicWorld = {
  map_url: '/media/rooms/r/map/mundo.jpg',
  map_width: 800,
  map_height: 500,
  visible: true,
  factions: [
    { id: 'imp', kind: 'nation', name: 'Império de Ferro', emblem_url: null, color: '#8a6d3b', leader: 'Imperatriz Liria', seat: 'Ferrópolis', description: 'Forjas sem fim.', parent_id: null, sort_order: 0 },
    { id: 'guild', kind: 'faction', name: 'Guilda das Sombras', emblem_url: null, color: '#333333', leader: '', seat: '', description: '', parent_id: 'imp', sort_order: 0 },
  ],
  relations: [{ id: 'r', a_id: 'guild', b_id: 'imp', kind: 'war', note: 'Fronteira em chamas' }],
};

describe('<WorldView />', () => {
  beforeEach(() => {
    useServer.setState({ server: { url: 'http://192.168.0.20:8080', name: 'Casa', version: '0.3.0', serverId: 'x', registrationOpen: true } });
  });

  it('mostra o que o Mestre revelou: nações, facções e relações', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<WorldView world={world} />);
    });
    const texts = tree.root
      .findAll((n) => typeof n.props.children === 'string' || Array.isArray(n.props.children))
      .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children) as string);
    expect(texts.join('|')).toMatch(/Nações/);
    expect(texts.join('|')).toMatch(/Facções/);
    expect(texts.join('|')).toMatch(/Guilda das Sombras ⟷ Império de Ferro/);
    expect(texts.join('|')).toMatch(/Guerra/);
    act(() => tree.unmount());
  });

  it('sem nada revelado, explica o que vai aparecer', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<WorldView world={null} />);
    });
    expect(tree.root.findAll((n) => n.props.children === 'O mundo ainda é um mistério').length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });
});
