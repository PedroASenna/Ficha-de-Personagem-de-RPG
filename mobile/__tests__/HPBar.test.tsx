import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { HPBar } from '../src/components/hud/HPBar';
import type { HpTransition } from '../src/components/hud/hpBarLogic';

describe('<HPBar />', () => {
  it('expõe o valor para leitores de tela e notifica dano e cura', () => {
    const transitions: HpTransition[] = [];
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<HPBar current={20} max={20} onTransition={(t) => transitions.push(t)} testID="hp" />);
    });
    const bar = () => tree.root.find((n) => n.props.testID === 'hp' && n.props.accessibilityRole === 'progressbar');
    expect(bar().props.accessibilityValue).toMatchObject({ min: 0, max: 20, now: 20, text: '20 de 20 pontos de vida' });

    act(() => tree.update(<HPBar current={12} max={20} onTransition={(t) => transitions.push(t)} testID="hp" />));
    expect(transitions.at(-1)).toMatchObject({ kind: 'damage', delta: -8 });
    expect(bar().props.accessibilityValue.now).toBe(12);

    act(() => tree.update(<HPBar current={18} max={20} temp={3} onTransition={(t) => transitions.push(t)} testID="hp" />));
    expect(transitions.at(-1)).toMatchObject({ kind: 'heal', delta: 6 });
    expect(bar().props.accessibilityValue.text).toBe('18 de 20 pontos de vida, mais 3 temporários');
    act(() => tree.unmount());
  });
});
