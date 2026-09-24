/**
 * Ajudantes da ficha de pontos (GURPS) e de dados (Savage Worlds). As contas de verdade são do servidor
 * (character.sheet); aqui só o que a tela precisa para responder na hora ao toque.
 */
import type { SkillDef, TraitCost, TraitDef } from './types';

const DICE = [4, 6, 8, 10, 12];

/** Tira acentos e caixa para a busca ("vitalidade" acha "Vitalidade", "aptidao" acha "Aptidão"). */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Busca por nome (e grupo/categoria), com os que começam pelo termo primeiro. */
export function search<T extends { name: string; category?: string; group?: string }>(items: T[], query: string, limit = 40): T[] {
  const q = fold(query.trim());
  if (!q) return items.slice(0, limit);
  const scored = items
    .map((item) => {
      const name = fold(item.name);
      const extra = fold(`${item.category ?? ''} ${item.group ?? ''}`);
      const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : extra.includes(q) ? 2 : 3;
      return { item, score };
    })
    .filter((x) => x.score < 3)
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name, 'pt-BR'));
  return scored.slice(0, limit).map((x) => x.item);
}

/** Pontos numa perícia do GURPS: 1, 2, 4, 8, 12, 16... */
export function nextSkillPoints(points: number, delta: 1 | -1): number {
  if (delta > 0) return points < 2 ? points + 1 : points < 4 ? 4 : points + 4;
  if (points <= 1) return 0;
  return points <= 2 ? 1 : points <= 4 ? 2 : points - 4;
}

/** Próximo tipo de dado (d4 → d6 → ... → d12), sem passar do mínimo nem do d12. */
export function nextDie(die: number, delta: 1 | -1, min = 4): number {
  const index = Math.max(0, DICE.indexOf(die)) + delta;
  const next = DICE[Math.min(DICE.length - 1, Math.max(0, index))]!;
  return Math.max(min, next);
}

export function dieLabel(die: number): string {
  return `d${die}`;
}

/** Como o custo aparece na lista do livro: "10/nível", "0 ou 5", "-5 a -15", "Variável"... */
export function costLabel(cost: TraitCost | null): string {
  if (!cost) return '';
  let text: string;
  if (cost.fixed !== null) text = String(cost.fixed);
  else if (cost.per_level.length) text = `${cost.base ? `${cost.base} + ` : ''}${cost.per_level.join(' ou ')}/${cost.unit ?? 'nível'}`;
  else if (cost.options.length) text = cost.options.join(' ou ');
  else if (cost.min !== null && cost.max !== null) text = `${cost.min} a ${cost.max}`;
  else if (cost.min !== null) text = `${cost.min}+`;
  else text = 'Variável';
  return cost.self_control ? `${text}*` : text;
}

/** A vantagem/desvantagem precisa de escolhas antes de entrar na ficha (nível, custo, autocontrole)? */
export function traitNeedsSetup(trait: TraitDef): boolean {
  const cost = trait.cost;
  if (trait.severity === 'either') return true;
  if (trait.name.endsWith('(descreva)')) return true;
  if (!cost) return false;
  return cost.fixed === null || cost.self_control;
}

/** Custo que a tela mostra antes de salvar (o servidor confere de novo). */
export function previewCost(
  trait: TraitDef,
  entry: { level?: number; per?: number | null; base_cost?: number | null; self_control?: number | null },
): number | null {
  const cost = trait.cost;
  if (!cost) return null;
  let base: number | null;
  if (cost.fixed !== null) base = cost.fixed;
  else if (cost.per_level.length) base = cost.base + (entry.per ?? cost.per_level[0]!) * (entry.level ?? 1);
  else base = entry.base_cost ?? null;
  if (base === null) return null;
  if (!cost.self_control) return base;
  const factor = { 6: 2, 9: 1.5, 12: 1, 15: 0.5 }[entry.self_control ?? 12] ?? 1;
  return Math.trunc(base * factor);
}

const KIND_LABEL: Record<TraitDef['kind'], string> = {
  advantage: 'Vantagem',
  disadvantage: 'Desvantagem',
  perk: 'Qualidade',
  quirk: 'Peculiaridade',
  edge: 'Vantagem',
  hindrance: 'Complicação',
  power: 'Poder',
};

export function kindLabel(kind: TraitDef['kind']): string {
  return KIND_LABEL[kind];
}

export const SEVERITY_LABEL = { minor: 'Menor', major: 'Maior', either: 'Menor ou Maior' } as const;

export const RANKS = ['Novato', 'Experiente', 'Veterano', 'Heroico', 'Lendário'];

/** Linha de apoio de uma perícia na lista: "DX/M · pág. 177" ou "Agilidade · pág. 26". */
export function skillHint(skill: SkillDef, attributeName: (key: string) => string): string {
  const attr = attributeName(skill.attribute);
  const base = skill.difficulty ? `${attr}/${skill.difficulty}` : attr;
  return [base, skill.group, skill.page ? `pág. ${skill.page}` : null].filter(Boolean).join(' · ');
}
