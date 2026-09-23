/**
 * Lógica pura da barra de HP (testada em __tests__/hpBarLogic.test.ts).
 * O componente só traduz a transição calculada aqui em animações.
 */

export type HpSnapshot = { current: number; max: number; temp: number };

export type HpTransitionKind = 'damage' | 'heal' | 'shield' | 'none';

export type HpTransition = {
  kind: HpTransitionKind;
  /** Frações 0..1 do PV antes/depois. */
  from: number;
  to: number;
  /** Variação de PV (negativa no dano). */
  delta: number;
  /** 0..1: quanto do PV máximo mudou; escala tremor, partículas e haptics. */
  intensity: number;
  shakePx: number;
  particleCount: number;
  /** Entrou na faixa crítica (<= 25%) com este golpe. */
  enteredCritical: boolean;
  downed: boolean;
};

export const CRITICAL_FRACTION = 0.25;

/** Tempos (ms) das camadas: o preenchimento cai rápido e o "sangramento" drena depois. */
export const HP_TIMING = {
  damageDrop: 150,
  bleedHold: 250,
  bleedDrain: 600,
  healLead: 120,
  healGlowIn: 180,
  healGlowOut: 700,
  shakeStep: 40,
  heartbeat: 450,
} as const;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function fraction(value: number, max: number): number {
  return max <= 0 ? 0 : clamp(value / max, 0, 1);
}

export function computeHpTransition(prev: HpSnapshot, next: HpSnapshot): HpTransition {
  const from = fraction(prev.current, prev.max);
  const to = fraction(next.current, next.max);
  const delta = next.current - prev.current;
  const base = {
    from,
    to,
    delta,
    intensity: 0,
    shakePx: 0,
    particleCount: 0,
    enteredCritical: false,
    downed: false,
  };

  if (delta < 0) {
    const intensity = clamp(-delta / Math.max(1, next.max), 0, 1);
    return {
      ...base,
      kind: 'damage',
      intensity,
      shakePx: Math.round(2 + 10 * intensity),
      enteredCritical: from > CRITICAL_FRACTION && to <= CRITICAL_FRACTION && next.current > 0,
      downed: next.current === 0 && prev.current > 0,
    };
  }
  if (delta > 0) {
    const intensity = clamp(delta / Math.max(1, next.max), 0, 1);
    return {
      ...base,
      kind: 'heal',
      intensity,
      particleCount: clamp(Math.round(6 + 18 * intensity), 6, 24),
    };
  }
  if (next.temp !== prev.temp) {
    return { ...base, kind: 'shield', intensity: clamp(Math.abs(next.temp - prev.temp) / Math.max(1, next.max), 0, 1) };
  }
  return { ...base, kind: 'none' };
}

/** Sequência de deslocamentos do tremor (amortecida). */
export function shakeKeyframes(px: number): number[] {
  if (px <= 0) return [];
  return [px, -px, px * 0.6, -px * 0.6, px * 0.3, 0];
}

export function hpLabel({ current, max, temp }: HpSnapshot): string {
  return temp > 0 ? `${current}/${max} (+${temp})` : `${current}/${max}`;
}

export function hpAccessibilityText({ current, max, temp }: HpSnapshot): string {
  const base = `${current} de ${max} pontos de vida`;
  return temp > 0 ? `${base}, mais ${temp} temporários` : base;
}
