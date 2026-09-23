import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";

export interface RulesetAttribute {
  key: string;
  name: string;
  abbr: string;
}

interface RulesetPack {
  id: string;
  name: string;
  attributes: RulesetAttribute[];
  dice: { default_check: string };
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
