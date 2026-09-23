import * as fs from 'fs';
import * as path from 'path';

import { EFFECTS } from '../src/lib/dice/effects';
import { keptPositive, rollLocal } from '../src/lib/dice/engine';
import { canonical, NotationError, parse } from '../src/lib/dice/notation';
import { classifyDice, OutcomeRules } from '../src/lib/dice/outcome';
import { rollOffline } from '../src/lib/dice/roller';

const SHARED = path.resolve(__dirname, '../../shared');
const readShared = (name: string) => JSON.parse(fs.readFileSync(path.join(SHARED, name), 'utf-8'));

describe('notação (mesmos casos do backend)', () => {
  it.each([
    ['d20', '1d20'],
    ['1d20+5', '1d20+5'],
    [' 2D20KH1 + 3 ', '2d20kh1+3'],
    ['4d6kh3', '4d6kh3'],
    ['d%', '1d100'],
    ['3d6-2', '3d6-2'],
    ['1d8+1d6+2', '1d8+1d6+2'],
    ['-1d4+10', '-1d4+10'],
    ['2d20kl1', '2d20kl1'],
    ['1d1000', '1d1000'],
    ['d5+d16+d24+d30+d60', '1d5+1d16+1d24+1d30+1d60'],
  ])('%s → %s', (input, expected) => {
    expect(canonical(parse(input))).toBe(expected);
  });

  it.each(['', 'abc', 'd7', '1d3', '0d6', '101d6', '4d6kh5', '1d20++5', '1d20 5', '5', 'd20' + '+1'.repeat(40), '1d20+99999'])(
    'rejeita %s',
    (input) => {
      expect(() => parse(input)).toThrow(NotationError);
    },
  );
});

describe('classificação (shared/dice-outcome-vectors.json)', () => {
  const data = readShared('dice-outcome-vectors.json') as {
    rules: Record<string, OutcomeRules>;
    cases: { name: string; rules: string; kept: [number, number][]; expected: { tier: string; natural: number | null; intensity: number } }[];
  };

  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const outcome = classifyDice(c.kept, data.rules[c.rules]);
    expect(outcome.tier).toBe(c.expected.tier);
    expect(outcome.natural).toBe(c.expected.natural);
    expect(outcome.intensity).toBeCloseTo(c.expected.intensity, 9);
  });

  it('presets de efeito idênticos aos do servidor', () => {
    expect(EFFECTS).toEqual(readShared('dice-effects.json'));
  });
});

describe('motor local', () => {
  it('mantém os maiores em 4d6kh3 e soma o modificador', () => {
    const seq = [2, 6, 5, 1];
    let i = 0;
    const roll = rollLocal(parse('4d6kh3+2'), () => seq[i++]!);
    expect(roll.terms[0]!.dice.map((d) => d.kept)).toEqual([true, true, true, false]);
    expect(roll.total).toBe(2 + 6 + 5 + 2);
    expect(keptPositive(roll)).toEqual([
      [6, 2],
      [6, 6],
      [6, 5],
    ]);
  });

  it('vantagem com empate mantém o primeiro dado', () => {
    const roll = rollLocal(parse('2d20kh1'), () => 12);
    expect(roll.terms[0]!.dice.map((d) => d.kept)).toEqual([true, false]);
  });

  it('rolagem offline respeita os limites de cada dado suportado', () => {
    for (const sides of [2, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 60, 100, 1000]) {
      for (let n = 0; n < 50; n++) {
        const { roll, outcome } = rollOffline(`1d${sides}`);
        expect(roll.total).toBeGreaterThanOrEqual(1);
        expect(roll.total).toBeLessThanOrEqual(sides);
        expect(outcome.effect).toBe(EFFECTS[outcome.tier]);
      }
    }
  });
});
