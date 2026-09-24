/** Texto curto do resultado de um teste (GURPS, Savage Worlds ou CD), para a bandeja e o log. */
import type { CheckPayload, RollPayload } from '../types';

export function checkText(check: CheckPayload): string {
  if (check.kind === 'savage') {
    if (check.critical) return 'Olhos de cobra! Falha crítica';
    if (!check.success) return 'Falha';
    const raises = check.raises ?? 0;
    return raises === 0 ? 'Sucesso' : `Sucesso + ${raises} ampliaç${raises === 1 ? 'ão' : 'ões'}`;
  }
  if (check.critical) {
    if (!check.success) return 'FALHA CRÍTICA';
    return check.kind === 'gurps' ? 'SUCESSO DECISIVO' : 'CRÍTICO';
  }
  const margin = Math.abs(check.margin ?? 0);
  return `${check.success ? 'Sucesso' : 'Falha'} por ${margin} (alvo ${check.target})`;
}

/** Valores dos dados para o detalhe: "8+3" quando o dado explodiu, "(4)" quando não contou. */
export function diceText(roll: RollPayload): string {
  return roll.terms
    .map((t) => {
      const dice = t.dice.map((d) => {
        const value = d.rolls && d.rolls.length > 1 ? d.rolls.join('+') : String(d.value);
        return d.kept ? value : `(${value})`;
      });
      return `${t.wild ? 'selvagem ' : ''}[${dice.join(', ')}]`;
    })
    .join(' ');
}
