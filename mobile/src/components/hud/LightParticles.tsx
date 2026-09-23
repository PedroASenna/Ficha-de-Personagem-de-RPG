import { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { mulberry32 } from '../../lib/random';

type ParticleSpec = {
  id: number;
  x: number;
  y: number;
  delay: number;
  rise: number;
  drift: number;
  size: number;
  duration: number;
  color: string;
};

function Particle({ spec }: { spec: ParticleSpec }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(spec.delay, withTiming(1, { duration: spec.duration, easing: Easing.out(Easing.quad) }));
    // Valores primitivos: re-render do pai com o mesmo seed não reinicia a animação.
  }, [progress, spec.delay, spec.duration]);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85,
      transform: [{ translateY: -spec.rise * p }, { translateX: spec.drift * p }, { scale: 1 - 0.5 * p }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        {
          left: spec.x,
          top: spec.y,
          width: spec.size,
          height: spec.size,
          borderRadius: spec.size / 2,
          backgroundColor: spec.color,
          shadowColor: spec.color,
        },
        style,
      ]}
    />
  );
}

type Props = {
  /** Muda a cada explosão para gerar novas partículas. */
  seed: number;
  count: number;
  /** Faixa horizontal (px) onde as partículas nascem. */
  fromX: number;
  toX: number;
  /** Altura (px) da linha de onde sobem. */
  baseY: number;
  colors: string[];
};

/** Partículas de luz subindo (cura). Tudo roda na UI thread via Reanimated. */
export function LightParticles({ seed, count, fromX, toX, baseY, colors }: Props) {
  const specs = useMemo<ParticleSpec[]>(() => {
    const random = mulberry32(seed);
    return Array.from({ length: count }, (_, id) => ({
      id,
      x: fromX + random() * Math.max(1, toX - fromX),
      y: baseY - random() * 6,
      delay: random() * 220,
      rise: 16 + random() * 30,
      drift: (random() - 0.5) * 16,
      size: 3 + random() * 4,
      duration: 650 + random() * 450,
      color: colors[id % colors.length] ?? '#FFFFFF',
    }));
  }, [seed, count, fromX, toX, baseY, colors]);

  return (
    <>
      {specs.map((spec) => (
        <Particle key={`${seed}-${spec.id}`} spec={spec} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
});
