/**
 * Efeitos de tela por faixa de resultado (explosão de luz, confete, brasas, vinheta colorida).
 * Procedurais (Reanimated) por padrão; um asset do LottieFiles pode substituir qualquer animação
 * registrando-o em EFFECT_ASSETS (confira a licença do asset antes de publicar).
 */
import LottieView from 'lottie-react-native';
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { EffectPreset, PALETTES } from '../../lib/dice/effects';
import { mulberry32 } from '../../lib/random';
import { LightParticles } from '../hud/LightParticles';

type LottieSource = React.ComponentProps<typeof LottieView>['source'];

/** Ex.: golden_burst: require('../../../assets/lottie/golden-burst.json') */
export const EFFECT_ASSETS: Partial<Record<EffectPreset['animation'], LottieSource>> = {};

type Piece = { id: number; x: number; delay: number; duration: number; rotate: number; w: number; h: number; color: string; sway: number };

function FallingPiece({ piece, fall }: { piece: Piece; fall: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(piece.delay, withTiming(1, { duration: piece.duration, easing: Easing.in(Easing.quad) }));
  }, [p, piece.delay, piece.duration]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.85 ? 1 : 1 - (p.value - 0.85) / 0.15,
    transform: [
      { translateY: fall * p.value },
      { translateX: Math.sin(p.value * 6) * piece.sway },
      { rotate: `${piece.rotate * p.value}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[{ position: 'absolute', top: -12, left: piece.x, width: piece.w, height: piece.h, backgroundColor: piece.color }, style]}
    />
  );
}

function Falling({ seed, count, width, height, colors, embers }: { seed: number; count: number; width: number; height: number; colors: string[]; embers?: boolean }) {
  const pieces = useMemo<Piece[]>(() => {
    const random = mulberry32(seed);
    return Array.from({ length: count }, (_, id) => ({
      id,
      x: random() * width,
      delay: random() * (embers ? 300 : 250),
      duration: (embers ? 1400 : 1100) + random() * 700,
      rotate: (random() - 0.5) * 720,
      w: embers ? 4 : 6 + random() * 4,
      h: embers ? 4 : 10 + random() * 6,
      color: colors[id % colors.length] ?? '#FFF',
      sway: embers ? 4 : 18,
    }));
  }, [seed, count, width, colors, embers]);
  return (
    <>
      {pieces.map((piece) => (
        <FallingPiece key={`${seed}-${piece.id}`} piece={piece} fall={height + 24} />
      ))}
    </>
  );
}

function LightBurst({ seed, x, y, color }: { seed: number; x: number; y: number; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
  }, [p, seed]);
  const style = useAnimatedStyle(() => ({ opacity: 0.9 * (1 - p.value), transform: [{ scale: 0.2 + 3.2 * p.value }] }));
  const size = 120;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

function Vignette({ seed, color, strong }: { seed: number; color: string; strong: boolean }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withSequence(withTiming(strong ? 0.55 : 0.3, { duration: 90 }), withTiming(0, { duration: strong ? 900 : 600 }));
  }, [p, seed, strong]);
  const style = useAnimatedStyle(() => ({ opacity: p.value }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderWidth: 18, borderColor: color }, style]} />;
}

type Props = {
  seed: number;
  effect: EffectPreset;
  intensity: number;
  width: number;
  height: number;
  /** Onde o dado principal parou (centro da explosão de luz). */
  focus: { x: number; y: number };
};

export function OutcomeEffects({ seed, effect, intensity, width, height, focus }: Props) {
  const palette = PALETTES[effect.palette];
  const lottie = EFFECT_ASSETS[effect.animation];
  const showVignette = effect.animation === 'die_crack' || effect.animation === 'golden_burst' || effect.animation === 'dim_pulse';

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {showVignette ? <Vignette seed={seed} color={palette.glow} strong={effect.animation !== 'dim_pulse'} /> : null}
      {effect.light_burst ? <LightBurst seed={seed} x={focus.x} y={focus.y} color={palette.glow} /> : null}
      {effect.particles === 'confetti' ? (
        <Falling seed={seed} count={Math.round(28 + 20 * intensity)} width={width} height={height} colors={palette.particles} />
      ) : null}
      {effect.particles === 'embers_dark' ? (
        <Falling seed={seed} count={18} width={width} height={height} colors={palette.particles} embers />
      ) : null}
      {effect.particles === 'sparkles' ? (
        <LightParticles seed={seed} count={14} fromX={focus.x - 40} toX={focus.x + 40} baseY={focus.y} colors={palette.particles} />
      ) : null}
      {lottie ? (
        <LottieView key={seed} source={lottie} autoPlay loop={false} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
    </View>
  );
}
