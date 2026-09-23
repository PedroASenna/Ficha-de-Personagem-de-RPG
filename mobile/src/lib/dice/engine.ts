import { canonical, DiceExpression, termToString } from './notation';
import type { RollPayload } from '../types';

/** Gerador 1..n. Offline usa Math.random; na mesa quem rola é o servidor (anti-trapaça). */
export type Rng = (sides: number) => number;

export const defaultRng: Rng = (sides) => 1 + Math.floor(Math.random() * sides);

function keepFlags(values: number[], keep: 'kh' | 'kl' | undefined, keepN: number | undefined): boolean[] {
  if (!keep || keepN === undefined) return values.map(() => true);
  // Empate: mantém o que saiu primeiro (mesma regra do backend).
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (keep === 'kh' ? b.v - a.v : a.v - b.v) || a.i - b.i)
    .slice(0, keepN)
    .map((x) => x.i);
  const kept = new Set(order);
  return values.map((_, i) => kept.has(i));
}

export function rollLocal(expr: DiceExpression, rng: Rng = defaultRng): RollPayload {
  const terms = expr.terms.map((term) => {
    const values = Array.from({ length: term.count }, () => rng(term.sides));
    const flags = keepFlags(values, term.keep, term.keepN);
    const dice = values.map((value, i) => ({ sides: term.sides, value, kept: flags[i] ?? true }));
    const subtotal = term.sign * dice.filter((d) => d.kept).reduce((sum, d) => sum + d.value, 0);
    return { notation: termToString(term), sign: term.sign, dice, subtotal };
  });
  const total = terms.reduce((sum, t) => sum + t.subtotal, 0) + expr.modifier;
  return { notation: canonical(expr), terms, modifier: expr.modifier, total };
}

/** Pares [lados, valor] dos dados mantidos com sinal positivo (entrada da classificação). */
export function keptPositive(roll: RollPayload): [number, number][] {
  return roll.terms
    .filter((t) => t.sign > 0)
    .flatMap((t) => t.dice.filter((d) => d.kept).map((d) => [d.sides, d.value] as [number, number]));
}
