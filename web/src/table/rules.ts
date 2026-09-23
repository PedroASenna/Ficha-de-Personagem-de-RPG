import type { Condition, RollTier } from "../api/types";

/** Modificador estilo d20 (todos os sistemas atuais usam a estratégia "dnd"). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

/** Notação para um teste de atributo: 1d20+3, 1d20-1, 1d20. */
export function checkNotation(score: number, die = "1d20"): string {
  const modifier = abilityModifier(score);
  return modifier === 0 ? die : `${die}${formatModifier(modifier)}`;
}

export function hpRatio(current: number, max: number): number {
  return max > 0 ? Math.min(1, Math.max(0, current / max)) : 0;
}

export function hpColor(ratio: number): string {
  if (ratio <= 0) return "#6b6159";
  if (ratio > 0.5) return "#62c370";
  if (ratio > 0.25) return "#e3a13b";
  return "#e0584a";
}

export const CONDITION_COLOR: Record<Condition, string> = {
  ileso: "#62c370",
  ferido: "#e3a13b",
  muito_ferido: "#e0584a",
  caido: "#6b6159",
};

export const TIER_COLOR: Record<RollTier, string> = {
  critical_failure: "#e0584a",
  low: "#b0856a",
  neutral: "#cfc6b8",
  high: "#9fd49a",
  critical_success: "#f2c14e",
};

/** Notação de dados aceita pelo servidor (validação leve só para habilitar o botão). */
export function looksLikeNotation(text: string): boolean {
  return /^\s*\d*d\d+/i.test(text) || /^\s*\d+\s*$/.test(text);
}
