import {
  computeHpTransition,
  fraction,
  hpAccessibilityText,
  hpLabel,
  shakeKeyframes,
} from '../src/components/hud/hpBarLogic';

describe('computeHpTransition', () => {
  it('dano: intensidade proporcional, tremor e sem partículas', () => {
    const t = computeHpTransition({ current: 20, max: 20, temp: 0 }, { current: 15, max: 20, temp: 0 });
    expect(t.kind).toBe('damage');
    expect(t.from).toBe(1);
    expect(t.to).toBe(0.75);
    expect(t.intensity).toBeCloseTo(0.25);
    expect(t.shakePx).toBe(5); // 2 + 10 * 0.25 arredondado
    expect(t.particleCount).toBe(0);
    expect(t.downed).toBe(false);
  });

  it('dano que leva à faixa crítica e dano que derruba', () => {
    const critical = computeHpTransition({ current: 10, max: 20, temp: 0 }, { current: 4, max: 20, temp: 0 });
    expect(critical.enteredCritical).toBe(true);
    const downed = computeHpTransition({ current: 4, max: 20, temp: 0 }, { current: 0, max: 20, temp: 0 });
    expect(downed.downed).toBe(true);
    expect(downed.enteredCritical).toBe(false);
  });

  it('golpe massivo satura o tremor em 12px', () => {
    const t = computeHpTransition({ current: 50, max: 50, temp: 0 }, { current: 0, max: 50, temp: 0 });
    expect(t.intensity).toBe(1);
    expect(t.shakePx).toBe(12);
  });

  it('cura: partículas entre 6 e 24 conforme o tamanho da cura', () => {
    const small = computeHpTransition({ current: 5, max: 100, temp: 0 }, { current: 6, max: 100, temp: 0 });
    expect(small.kind).toBe('heal');
    expect(small.particleCount).toBe(6);
    const big = computeHpTransition({ current: 0, max: 10, temp: 0 }, { current: 10, max: 10, temp: 0 });
    expect(big.particleCount).toBe(24);
    expect(big.shakePx).toBe(0);
  });

  it('só PV temporário muda → escudo; nada muda → none', () => {
    expect(computeHpTransition({ current: 5, max: 10, temp: 0 }, { current: 5, max: 10, temp: 4 }).kind).toBe('shield');
    expect(computeHpTransition({ current: 5, max: 10, temp: 0 }, { current: 5, max: 10, temp: 0 }).kind).toBe('none');
  });

  it('subir de nível (PV máximo muda) não conta como dano nem cura', () => {
    const t = computeHpTransition({ current: 10, max: 10, temp: 0 }, { current: 10, max: 16, temp: 0 });
    expect(t.kind).toBe('none');
    expect(t.to).toBeCloseTo(10 / 16);
  });
});

describe('helpers', () => {
  it('fraction limita a 0..1 e trata máximo zero', () => {
    expect(fraction(15, 10)).toBe(1);
    expect(fraction(-3, 10)).toBe(0);
    expect(fraction(3, 0)).toBe(0);
  });

  it('tremor amortecido termina em zero', () => {
    const frames = shakeKeyframes(10);
    expect(frames[0]).toBe(10);
    expect(frames[frames.length - 1]).toBe(0);
    expect(shakeKeyframes(0)).toEqual([]);
  });

  it('rótulos visual e de acessibilidade', () => {
    expect(hpLabel({ current: 7, max: 12, temp: 0 })).toBe('7/12');
    expect(hpLabel({ current: 7, max: 12, temp: 3 })).toBe('7/12 (+3)');
    expect(hpAccessibilityText({ current: 7, max: 12, temp: 3 })).toBe('7 de 12 pontos de vida, mais 3 temporários');
  });
});
