import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";

export interface RulesetAttribute {
  key: string;
  name: string;
  abbr: string;
}

export interface LevelUpRule {
  max_level: number;
  asi_levels: number[];
  asi_points: number;
  attribute_max: number | null;
  free_points: boolean;
}

export interface RulesetPack {
  id: string;
  name: string;
  attributes: RulesetAttribute[];
  dice: { default_check: string };
  hp: { strategy: "hit_die_max_plus_mod" | "fixed" | "manual" | "engine" };
  level_up: LevelUpRule;
  /** classic (5ª edição, genérico), gurps ou savage. */
  engine?: RulesetEngine;
}

export type RulesetEngine = "classic" | "gurps" | "savage";

/** O que o próximo nível dá: PV automáticos (pela classe) ou digitados, e pontos de atributo. */
export function nextLevelRules(pack: Pick<RulesetPack, "hp" | "level_up">, level: number) {
  const rule = pack.level_up;
  const next = level + 1;
  const points = rule.free_points ? 10 : rule.asi_levels.includes(next) ? rule.asi_points : 0;
  return {
    next,
    atMax: next > rule.max_level,
    hpAutomatic: pack.hp.strategy === "hit_die_max_plus_mod",
    // free: até 10 pontos, quantos quiser; senão exatamente `points` (ou nenhum).
    free: rule.free_points,
    points,
    attributeMax: rule.attribute_max,
  };
}

/** Atributos do sistema da mesa (FOR/DES/CON… no SRD; FOR/AGI/VIG… no genérico). */
export function useRuleset(rulesetId: string | undefined) {
  return useQuery({
    queryKey: ["ruleset", rulesetId],
    queryFn: () => api<RulesetPack>(`/rulesets/${rulesetId}`, { auth: false }),
    enabled: Boolean(rulesetId),
    staleTime: Infinity,
  });
}
