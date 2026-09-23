import { api, ApiError } from '../api';
import type { RollResponse } from '../types';
import { keptPositive, rollLocal } from './engine';
import { parse } from './notation';
import { classifyDice, OutcomeRules } from './outcome';

/** Rolagem local (offline): mesmo formato e mesma classificação que o servidor. */
export function rollOffline(notation: string, rules: OutcomeRules = {}): RollResponse {
  const roll = rollLocal(parse(notation));
  const outcome = classifyDice(keptPositive(roll), rules);
  return { roll, outcome };
}

/** Solo: tenta o servidor; sem conexão, rola localmente para não travar o jogo. */
export async function rollSolo(notation: string, rulesetId?: string, rules?: OutcomeRules): Promise<RollResponse> {
  parse(notation); // valida antes de ir à rede
  try {
    return await api.roll(notation, rulesetId);
  } catch (e) {
    if (e instanceof ApiError && e.status !== 0) throw e;
    return rollOffline(notation, rules);
  }
}
