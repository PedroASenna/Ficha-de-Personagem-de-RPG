import { nextLevel, pointsValid } from '../src/lib/levelUp';

const srd = {
  hp: { strategy: 'hit_die_max_plus_mod' as const },
  level_up: { max_level: 20, asi_levels: [4, 8, 12, 16, 19], asi_points: 2, attribute_max: 20, free_points: false },
};
const generico = {
  hp: { strategy: 'fixed' as const },
  level_up: { max_level: 30, asi_levels: [], asi_points: 0, attribute_max: null, free_points: true },
};

describe('subir de nível', () => {
  it('5ª edição: PV pela classe e +2 só nos níveis de melhoria', () => {
    expect(nextLevel(srd, 2)).toMatchObject({ next: 3, points: 0, hpAutomatic: true, atMax: false });
    const four = nextLevel(srd, 3);
    expect(four).toMatchObject({ next: 4, points: 2, attributeMax: 20 });
    expect([0, 1, 2].map((spent) => pointsValid(four, spent))).toEqual([true, false, true]);
    expect(nextLevel(srd, 20).atMax).toBe(true);
  });

  it('genérico: PV digitados e pontos livres (até 10)', () => {
    const rules = nextLevel(generico, 1);
    expect(rules).toMatchObject({ hpAutomatic: false, free: true, points: 10 });
    expect(pointsValid(rules, 3) && pointsValid(rules, 0) && !pointsValid(rules, 11)).toBe(true);
  });
});
