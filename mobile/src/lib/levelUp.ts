/** O que o próximo nível dá, pelas regras do sistema (espelha backend/app/services/character_rules.py). */
import type { RulesetPack } from './types';

export type NextLevel = {
  next: number;
  atMax: boolean;
  /** PV calculados pela classe (5ª edição) ou digitados pelo jogador (sistemas livres). */
  hpAutomatic: boolean;
  /** Sistemas livres: até `points` pontos, quantos quiser; senão exatamente `points` (ou nenhum). */
  free: boolean;
  points: number;
  attributeMax: number | null;
};

export function nextLevel(pack: Pick<RulesetPack, 'hp' | 'level_up'>, level: number): NextLevel {
  const rule = pack.level_up;
  const next = level + 1;
  return {
    next,
    atMax: next > rule.max_level,
    hpAutomatic: pack.hp.strategy === 'hit_die_max_plus_mod',
    free: rule.free_points,
    points: rule.free_points ? 10 : rule.asi_levels.includes(next) ? rule.asi_points : 0,
    attributeMax: rule.attribute_max,
  };
}

/** Os pontos distribuídos podem ser enviados? */
export function pointsValid(rules: NextLevel, spent: number): boolean {
  return rules.free ? spent <= rules.points : spent === 0 || spent === rules.points;
}
