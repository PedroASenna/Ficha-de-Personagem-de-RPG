import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PaperProvider } from 'react-native-paper';

import { EngineSheet, WoundTrack } from '../src/components/sheet/EngineSheet';
import type { Character, SavageSheet } from '../src/lib/types';

const sheet: SavageSheet = {
  engine: 'savage',
  rank: { index: 1, name: 'Experiente' },
  xp: 22,
  advances: { earned: 4, taken: 3, available: 1 },
  creation: {
    attributes: { spent: 5, budget: 5 },
    skills: { spent: 15, budget: 15 },
    edges: { taken: 1, free: 1 },
    hindrances: { points: 4, spent: 4, majors: 1, minors: 2 },
    funds: 500,
  },
  derived: [
    { key: 'pace', label: 'Movimentação', value: 6 },
    { key: 'parry', label: 'Aparar', value: 6 },
    { key: 'toughness', label: 'Resistência', value: 5 },
    { key: 'bennies', label: 'Benes', value: 3, current: 2 },
  ],
  attributes: [{ key: 'agi', name: 'Agilidade', die: 8, label: 'd8' }],
  skills: [{ key: 'lutar', name: 'Lutar', die: 8, label: 'd8', attribute: 'AGI', category: '', page: '27' }],
  traits: [{ key: 'bloquear', name: 'Bloquear', note: '', kind: 'edge', source: 'advance', page: '40' }],
  wounds: { max: 3 },
  fatigue: 1,
  shaken: true,
  checks: [],
  warnings: [],
};

const character = { id: 'c', name: 'Kara', hp_max: 3, hp_current: 1, attributes: { agi: 8 }, sheet } as unknown as Character;

function texts(tree: ReactTestRenderer): string {
  return tree.root
    .findAll((n) => typeof n.props.children === 'string' || Array.isArray(n.props.children))
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children) as string)
    .join('|');
}

describe('<EngineSheet /> Savage Worlds', () => {
  it('mostra atributos em dado, contadores, perícias e Vantagens', () => {
    const onPatch = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <PaperProvider>
          <EngineSheet character={character} onPatchBuild={onPatch} />
        </PaperProvider>,
      );
    });
    const all = texts(tree);
    expect(all).toMatch(/Agilidade/);
    expect(all).toMatch(/2\/3/); // Benes
    expect(all).toMatch(/Abalado/);
    expect(all).toMatch(/Fatigado \(-1\)/);
    expect(all).toMatch(/Bloquear/);
    expect(all).toMatch(/Experiente · 22 XP · 1 Progresso/);
    const spend = tree.root.findByProps({ accessibilityLabel: 'Gastar Benes' });
    act(() => spend.props.onPress());
    expect(onPatch).toHaveBeenCalledWith({ bennies: 1 });
  });

  it('marca os ferimentos pelo PV (3 = ileso)', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <PaperProvider>
          <WoundTrack character={character} />
        </PaperProvider>,
      );
    });
    expect(tree.root.findByProps({ accessibilityLabel: '2 ferimento(s)' })).toBeTruthy();
  });
});
