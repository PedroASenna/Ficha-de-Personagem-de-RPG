/**
 * Presets de efeito por faixa de resultado — espelho de shared/dice-effects.json
 * (teste em __tests__/dice.test.ts garante que são iguais ao que o servidor envia).
 */

export type Tier = 'critical_failure' | 'low' | 'neutral' | 'high' | 'critical_success';

export type EffectPreset = {
  animation: 'die_crack' | 'dim_pulse' | 'settle' | 'glow_soft' | 'golden_burst';
  palette: 'blood' | 'ember' | 'stone' | 'gold_soft' | 'gold';
  sound: 'impact_dry' | 'thud_soft' | 'clack' | 'chime' | 'epic_fanfare';
  haptic: 'error_heavy' | 'impact_medium' | 'impact_light' | 'success_light' | 'success_heavy';
  shake: { px: number; ms: number };
  particles: 'embers_dark' | 'sparkles' | 'confetti' | null;
  crack: boolean;
  light_burst: boolean;
};

export const EFFECTS: Record<Tier, EffectPreset> = {
  critical_failure: {
    animation: 'die_crack',
    palette: 'blood',
    sound: 'impact_dry',
    haptic: 'error_heavy',
    shake: { px: 8, ms: 420 },
    particles: 'embers_dark',
    crack: true,
    light_burst: false,
  },
  low: {
    animation: 'dim_pulse',
    palette: 'ember',
    sound: 'thud_soft',
    haptic: 'impact_medium',
    shake: { px: 3, ms: 200 },
    particles: null,
    crack: false,
    light_burst: false,
  },
  neutral: {
    animation: 'settle',
    palette: 'stone',
    sound: 'clack',
    haptic: 'impact_light',
    shake: { px: 0, ms: 0 },
    particles: null,
    crack: false,
    light_burst: false,
  },
  high: {
    animation: 'glow_soft',
    palette: 'gold_soft',
    sound: 'chime',
    haptic: 'success_light',
    shake: { px: 0, ms: 0 },
    particles: 'sparkles',
    crack: false,
    light_burst: false,
  },
  critical_success: {
    animation: 'golden_burst',
    palette: 'gold',
    sound: 'epic_fanfare',
    haptic: 'success_heavy',
    shake: { px: 2, ms: 250 },
    particles: 'confetti',
    crack: false,
    light_burst: true,
  },
};

/** Cores de cada paleta: face do dado, brilho e partículas. */
export const PALETTES: Record<EffectPreset['palette'], { face: string; edge: string; glow: string; particles: string[] }> = {
  blood: { face: '#3A0A0C', edge: '#B3121B', glow: '#FF2A2A', particles: ['#8B0000', '#3B0B0B', '#FF4B2B'] },
  ember: { face: '#3A1E14', edge: '#A0522D', glow: '#D2691E', particles: ['#D2691E'] },
  stone: { face: '#2A2530', edge: '#8C8496', glow: '#BDB5C7', particles: ['#BDB5C7'] },
  gold_soft: { face: '#3B3013', edge: '#D4AF37', glow: '#FFE08A', particles: ['#FFE08A', '#FFF4C2'] },
  gold: { face: '#4A3A0A', edge: '#FFD700', glow: '#FFF4C2', particles: ['#FFD700', '#FFF4C2', '#FFA500', '#FF6F91', '#6FD3FF'] },
};
