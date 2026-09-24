import { checkRequest } from '../src/components/dice/CheckPicker';
import { costLabel, fold, nextDie, nextSkillPoints, previewCost, search, traitNeedsSetup } from '../src/lib/build';
import { checkText, diceText } from '../src/lib/dice/check';
import { rollLocal } from '../src/lib/dice/engine';
import { canonical, NotationError, parse } from '../src/lib/dice/notation';
import type { TraitCost, TraitDef } from '../src/lib/types';

const cost = (partial: Partial<TraitCost>): TraitCost => ({
  fixed: null,
  options: [],
  min: null,
  max: null,
  per_level: [],
  base: 0,
  unit: null,
  variable: false,
  self_control: false,
  ...partial,
});

const trait = (partial: Partial<TraitDef>): TraitDef => ({
  key: 'x',
  name: 'X',
  kind: 'advantage',
  category: '',
  tags: [],
  cost: null,
  severity: null,
  requirements: null,
  effects: { charisma: 0, parry: 0, toughness: 0, pace: 0, bennies: 0, attribute_points: 0, skill_points: 0, spell_bonus_per_level: 0 },
  info: {},
  page: null,
  ...partial,
});

describe('dados que explodem (Savage Worlds)', () => {
  it('aceita ! na notação, igual ao backend', () => {
    expect(canonical(parse('d8!+1'))).toBe('1d8!+1');
    expect(canonical(parse('1d4!-2'))).toBe('1d4!-2');
    expect(() => parse('1d2!')).toThrow(NotationError);
  });

  it('rola de novo no máximo e soma, guardando cada lançamento', () => {
    const values = [8, 8, 3];
    const roll = rollLocal(parse('1d8!+1'), () => values.shift()!);
    expect(roll.terms[0]!.dice[0]).toEqual({ sides: 8, value: 19, kept: true, rolls: [8, 8, 3] });
    expect(roll.total).toBe(20);
    expect(diceText(roll)).toBe('[8+8+3]');
  });
});

describe('texto do teste', () => {
  it('GURPS: margem, sucesso decisivo e falha crítica', () => {
    expect(checkText({ kind: 'gurps', target: 12, success: true, critical: false, margin: 3 })).toBe('Sucesso por 3 (alvo 12)');
    expect(checkText({ kind: 'gurps', target: 12, success: false, critical: false, margin: -2 })).toBe('Falha por 2 (alvo 12)');
    expect(checkText({ kind: 'gurps', target: 16, success: true, critical: true, margin: 10 })).toBe('SUCESSO DECISIVO');
    expect(checkText({ kind: 'gurps', target: 8, success: false, critical: true, margin: -10 })).toBe('FALHA CRÍTICA');
  });

  it('Savage: ampliações e olhos de cobra', () => {
    expect(checkText({ kind: 'savage', target: 4, success: true, critical: false, raises: 0 })).toBe('Sucesso');
    expect(checkText({ kind: 'savage', target: 4, success: true, critical: false, raises: 2 })).toBe('Sucesso + 2 ampliações');
    expect(checkText({ kind: 'savage', target: 4, success: false, critical: true, raises: 0 })).toContain('Olhos de cobra');
  });

  it('mostra o Dado Selvagem e o dado descartado', () => {
    const roll = {
      notation: '1d8!',
      modifier: 0,
      total: 6,
      terms: [
        { notation: '1d8!', sign: 1, dice: [{ sides: 8, value: 3, kept: false }], subtotal: 3 },
        { notation: '1d6!', sign: 1, wild: true, dice: [{ sides: 6, value: 6, kept: true }], subtotal: 6 },
      ],
    };
    expect(diceText(roll)).toBe('[(3)] selvagem [6]');
  });
});

describe('testes da ficha na bandeja', () => {
  it('GURPS: o modificador vai no NH', () => {
    const req = checkRequest({ check: { key: 'espadas', label: 'Espadas', notation: '3d6', target: 14, group: 'Perícias' }, modifier: -2 });
    expect(req).toEqual({ display: '3d6', notation: '3d6', target: 12, wild: false, label: 'Espadas 12' });
  });

  it('Savage: o modificador vai na rolagem e a bandeja mostra o Dado Selvagem', () => {
    const req = checkRequest({ check: { key: 'lutar', label: 'Lutar', notation: '1d8!', target: 4, wild: true, group: 'Perícias' }, modifier: 1 });
    expect(req).toEqual({ display: '1d8!+1+1d6!', notation: '1d8!+1', target: 4, wild: true, label: 'Lutar (+1)' });
    expect(canonical(parse(req.display))).toBe('1d8!+1d6!+1');
  });
});

describe('ficha de pontos', () => {
  it('perícias do GURPS: 1, 2, 4 e depois de 4 em 4', () => {
    const up = [1];
    for (let i = 0; i < 5; i++) up.push(nextSkillPoints(up[up.length - 1]!, 1));
    expect(up).toEqual([1, 2, 4, 8, 12, 16]);
    expect(nextSkillPoints(8, -1)).toBe(4);
    expect(nextSkillPoints(4, -1)).toBe(2);
    expect(nextSkillPoints(1, -1)).toBe(0);
  });

  it('dados do Savage: d4 a d12, respeitando o mínimo da raça', () => {
    expect(nextDie(4, 1)).toBe(6);
    expect(nextDie(12, 1)).toBe(12);
    expect(nextDie(6, -1, 6)).toBe(6);
    expect(nextDie(8, -1)).toBe(6);
  });

  it('custos como na lista do livro', () => {
    expect(costLabel(cost({ fixed: 15 }))).toBe('15');
    expect(costLabel(cost({ per_level: [10], base: 5 }))).toBe('5 + 10/nível');
    expect(costLabel(cost({ per_level: [5, 10] }))).toBe('5 ou 10/nível');
    expect(costLabel(cost({ options: [0, 5] }))).toBe('0 ou 5');
    expect(costLabel(cost({ min: -15, max: -5, self_control: true }))).toBe('-15 a -5*');
    expect(costLabel(cost({ variable: true }))).toBe('Variável');
  });

  it('prévia do custo com nível e autocontrole (frações truncadas)', () => {
    const furia = trait({ kind: 'disadvantage', cost: cost({ fixed: -15, self_control: true }) });
    expect(previewCost(furia, { self_control: 6 })).toBe(-30);
    expect(previewCost(furia, { self_control: 9 })).toBe(-22);
    expect(previewCost(trait({ cost: cost({ per_level: [10], base: 5 }) }), { level: 3 })).toBe(35);
    expect(previewCost(trait({ cost: cost({ variable: true }) }), {})).toBeNull();
    expect(traitNeedsSetup(furia)).toBe(true);
    expect(traitNeedsSetup(trait({ cost: cost({ fixed: 5 }) }))).toBe(false);
    expect(traitNeedsSetup(trait({ kind: 'hindrance', severity: 'either' }))).toBe(true);
  });

  it('busca ignora acentos e prioriza o começo do nome', () => {
    expect(fold('Aptidão Mágica')).toBe('aptidao magica');
    const items = [{ name: 'Visão Aguçada' }, { name: 'Aptidão Mágica' }, { name: 'Mágica Negra' }];
    expect(search(items, 'magica').map((i) => i.name)).toEqual(['Mágica Negra', 'Aptidão Mágica']);
  });
});
