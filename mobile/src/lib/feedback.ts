/** Haptics e efeitos sonoros ligados às chaves enviadas pelo servidor (effect.haptic / effect.sound). */
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';

import type { HpTransition } from '../components/hud/hpBarLogic';
import type { EffectPreset } from './dice/effects';

type SoundKey = EffectPreset['sound'] | 'heal_sparkle' | 'hit_flesh';

const SOURCES: Record<SoundKey, number> = {
  impact_dry: require('../../assets/sfx/impact_dry.wav'),
  thud_soft: require('../../assets/sfx/thud_soft.wav'),
  clack: require('../../assets/sfx/clack.wav'),
  chime: require('../../assets/sfx/chime.wav'),
  epic_fanfare: require('../../assets/sfx/epic_fanfare.wav'),
  heal_sparkle: require('../../assets/sfx/heal_sparkle.wav'),
  hit_flesh: require('../../assets/sfx/hit_flesh.wav'),
};

const players = new Map<SoundKey, AudioPlayer>();
let soundEnabled = true;
let hapticsEnabled = true;

export function setFeedbackPreferences(prefs: { sound?: boolean; haptics?: boolean }) {
  if (prefs.sound !== undefined) soundEnabled = prefs.sound;
  if (prefs.haptics !== undefined) hapticsEnabled = prefs.haptics;
}

export async function initFeedback() {
  // Efeitos curtos respeitam o modo silencioso e se misturam à música do usuário.
  await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false });
  for (const key of Object.keys(SOURCES) as SoundKey[]) {
    if (!players.has(key)) players.set(key, createAudioPlayer(SOURCES[key]));
  }
}

export function playSound(key: SoundKey, volume = 1) {
  if (!soundEnabled) return;
  const player = players.get(key);
  if (!player) return;
  player.volume = volume;
  void player.seekTo(0).then(() => player.play());
}

export function playHaptic(key: EffectPreset['haptic']) {
  if (!hapticsEnabled) return;
  switch (key) {
    case 'error_heavy':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 120);
      break;
    case 'impact_medium':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'impact_light':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case 'success_light':
      void Haptics.selectionAsync();
      break;
    case 'success_heavy':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 150);
      break;
  }
}

/** Toque leve quando o dado bate na borda (limitado para não virar zumbido). */
let lastTick = 0;
export function wallTick() {
  const now = Date.now();
  if (!hapticsEnabled || now - lastTick < 90) return;
  lastTick = now;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
}

export function playOutcome(effect: EffectPreset, intensity: number) {
  playSound(effect.sound, 0.6 + 0.4 * intensity);
  playHaptic(effect.haptic);
}

export function playHpFeedback(t: HpTransition) {
  if (t.kind === 'damage') {
    playSound('hit_flesh', 0.5 + 0.5 * t.intensity);
    playHaptic(t.intensity > 0.3 || t.downed ? 'error_heavy' : 'impact_medium');
  } else if (t.kind === 'heal') {
    playSound('heal_sparkle', 0.6 + 0.4 * t.intensity);
    playHaptic('success_light');
  } else if (t.kind === 'shield') {
    playHaptic('impact_light');
  }
}
