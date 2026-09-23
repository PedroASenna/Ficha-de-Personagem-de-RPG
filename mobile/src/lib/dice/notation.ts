/**
 * Parser de notação de dados — espelho de backend/app/services/dice/notation.py.
 * Usado para validar a entrada e para rolagens offline. Online, o servidor é quem rola.
 */

export const ALLOWED_SIDES = [2, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 60, 100, 1000] as const;
export type DieSides = (typeof ALLOWED_SIDES)[number];

export const MAX_DICE = 100;
export const MAX_MODIFIER = 10_000;
export const MAX_NOTATION_LENGTH = 64;

export class NotationError extends Error {}

export type DiceTerm = {
  count: number;
  sides: DieSides;
  sign: 1 | -1;
  keep?: 'kh' | 'kl';
  keepN?: number;
};

export type DiceExpression = {
  terms: DiceTerm[];
  modifier: number;
};

const TERM = /(?:(\d*)d(\d+|%)(?:(kh|kl)(\d+))?|(\d+))/y;

export function isAllowedSides(n: number): n is DieSides {
  return (ALLOWED_SIDES as readonly number[]).includes(n);
}

export function parse(notation: string): DiceExpression {
  if (!notation || notation.length > MAX_NOTATION_LENGTH) {
    throw new NotationError('Notação vazia ou longa demais.');
  }
  const source = notation.replace(/\s+/g, '').toLowerCase();
  if (!source) throw new NotationError('Notação vazia.');

  const terms: DiceTerm[] = [];
  let modifier = 0;
  let pos = 0;
  let first = true;
  while (pos < source.length) {
    let sign: 1 | -1 = 1;
    const ch = source[pos];
    if (ch === '+' || ch === '-') {
      sign = ch === '-' ? -1 : 1;
      pos += 1;
    } else if (!first) {
      throw new NotationError(`Esperado '+' ou '-' na posição ${pos + 1}.`);
    }
    TERM.lastIndex = pos;
    const match = TERM.exec(source);
    if (!match || TERM.lastIndex === pos) {
      throw new NotationError(`Termo inválido na posição ${pos + 1}.`);
    }
    pos = TERM.lastIndex;
    first = false;

    const [, countRaw, sidesRaw, keep, keepRaw, constant] = match;
    if (constant !== undefined) {
      modifier += sign * Number(constant);
      continue;
    }
    const count = countRaw ? Number(countRaw) : 1;
    const sides = sidesRaw === '%' ? 100 : Number(sidesRaw);
    if (!isAllowedSides(sides)) throw new NotationError(`Dado d${sides} não é suportado.`);
    if (count < 1) throw new NotationError('A quantidade de dados deve ser pelo menos 1.');
    const keepN = keep ? Number(keepRaw) : undefined;
    if (keepN !== undefined && (keepN < 1 || keepN > count)) {
      throw new NotationError(`Não dá para manter ${keepN} de ${count} dados.`);
    }
    terms.push({ count, sides, sign, keep: keep as DiceTerm['keep'], keepN });
  }

  if (terms.length === 0) throw new NotationError('A expressão precisa ter pelo menos um dado.');
  if (terms.reduce((n, t) => n + t.count, 0) > MAX_DICE) {
    throw new NotationError(`No máximo ${MAX_DICE} dados por rolagem.`);
  }
  if (Math.abs(modifier) > MAX_MODIFIER) throw new NotationError('Modificador grande demais.');
  return { terms, modifier };
}

export function termToString(term: DiceTerm): string {
  return `${term.count}d${term.sides}${term.keep ? `${term.keep}${term.keepN}` : ''}`;
}

export function canonical(expr: DiceExpression): string {
  let out = '';
  expr.terms.forEach((term, i) => {
    if (term.sign < 0) out += '-';
    else if (i > 0) out += '+';
    out += termToString(term);
  });
  if (expr.modifier > 0) out += `+${expr.modifier}`;
  else if (expr.modifier < 0) out += String(expr.modifier);
  return out;
}
