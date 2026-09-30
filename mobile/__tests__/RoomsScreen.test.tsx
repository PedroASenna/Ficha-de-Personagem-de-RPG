import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import RoomsScreen from '../src/app/(tabs)/rooms';
import { useServer } from '../src/state/server';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({}),
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('../src/lib/queries', () => ({ keys: { rooms: ['rooms'] }, useRooms: () => ({ data: [] }) }));

function texts(tree: ReactTestRenderer): string {
  return tree.root
    .findAll((n) => typeof n.props.children === 'string')
    .map((n) => n.props.children as string)
    .join('|');
}

describe('aba Mesas', () => {
  beforeEach(() => mockPush.mockReset());

  it('sem convite: só entrar pelo PIN, ler o QR ou criar mesa', () => {
    useServer.setState({ invitePin: null });
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<RoomsScreen />);
    });
    expect(texts(tree)).toMatch(/Entrar numa mesa/);
    expect(texts(tree)).not.toMatch(/Convite para a mesa/);
    act(() => tree.unmount());
  });

  it('com convite: o PIN já vem preenchido e dá para criar o personagem antes', () => {
    useServer.setState({ invitePin: 'ABCD23' });
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<RoomsScreen />);
    });
    expect(texts(tree)).toMatch(/Convite para a mesa ABCD23/);
    const input = tree.root.find((n) => n.props.label === 'PIN da sala' && n.props.value !== undefined);
    expect(input.props.value).toBe('ABCD23');

    const create_ = tree.root.find((n) => n.props.icon === 'account-plus' && typeof n.props.onPress === 'function');
    act(() => create_.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/character/new');

    const later = tree.root.find(
      (n) => typeof n.props.onPress === 'function' && n.props.children === 'Agora não',
    );
    act(() => later.props.onPress());
    expect(useServer.getState().invitePin).toBeNull();
    expect(texts(tree)).not.toMatch(/Convite para a mesa/);
    act(() => tree.unmount());
  });
});
