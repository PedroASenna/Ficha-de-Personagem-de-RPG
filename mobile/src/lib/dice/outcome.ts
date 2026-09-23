/**
 * Classificação emocional da rolagem — espelho de backend/app/services/dice/outcome.py.
 * Os dois lados passam pelos mesmos casos em shared/dice-outcome-vectors.json.
 */
import { EFFECTS, EffectPreset, Tier } from './effects';

export const LOW_THRESHOLD = 0.2;
export const HIGH_THRESHOLD = 0.8;
export const GENERIC_CRIT_MIN_OUTCOMES = 6;

export type CritRule = { sides: number; success: number[]; failure: number[] };

export type OutcomeRules = {
  crit_rules?: CritRule[];
  direction?: 'high' | 'low';
  generic_crits?: boolean;
};

export type Outcome = {
  tier: Tier;
  natural: number | null;
  intensity: number;
  effect: EffectPreset;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function outcome(tier: Tier, natural: number | null, intensity: number): Outcome {
  return { tier, natural, intensity, effect: EFFECTS[tier] };
}

export function classifyDice(kept: [number, number][], rules: OutcomeRules = {}): Outcome {
  const critRules = rules.crit_rules ?? [];
  const direction = rules.direction ?? 'high';
  const genericCrits = rules.generic_crits ?? true;

  if (kept.length === 0) return outcome('neutral', null, 0);

  const first = kept[0]!;
  const natural = kept.length === 1 ? first[1] : null;

  if (natural !== null) {
    for (const rule of critRules) {
      if (rule.sides === first[0]) {
        if (rule.success.includes(natural)) return outcome('critical_success', natural, 1);
        if (rule.failure.includes(natural)) return outcome('critical_failure', natural, 1);
      }
    }
  }

  const lowIsGood = direction === 'low';
  const coveredByRule = natural !== null && critRules.some((r) => r.sides === first[0]);
  const outcomes = kept.reduce((p, [sides]) => p * sides, 1);
  if (genericCrits && !coveredByRule && outcomes >= GENERIC_CRIT_MIN_OUTCOMES) {
    if (kept.every(([sides, value]) => value === sides)) {
      return outcome(lowIsGood ? 'critical_failure' : 'critical_success', natural, 1);
    }
    if (kept.every(([, value]) => value === 1)) {
      return outcome(lowIsGood ? 'critical_success' : 'critical_failure', natural, 1);
    }
  }

  const minimum = kept.length;
  const maximum = kept.reduce((s, [sides]) => s + sides, 0);
  const total = kept.reduce((s, [, value]) => s + value, 0);
  let ratio = maximum === minimum ? 0.5 : (total - minimum) / (maximum - minimum);
  if (lowIsGood) ratio = 1 - ratio;

  const tier: Tier = ratio <= LOW_THRESHOLD ? 'low' : ratio >= HIGH_THRESHOLD ? 'high' : 'neutral';
  return outcome(tier, natural, round3(Math.abs(ratio - 0.5) * 2));
}
