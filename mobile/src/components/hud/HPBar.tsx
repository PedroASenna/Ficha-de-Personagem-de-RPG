/**
 * Barra de HP animada do HUD de combate.
 *
 * Dano: o preenchimento cai rápido, uma camada vermelha escura "sangra" logo atrás
 *       (segura ~250 ms e drena), a barra treme e pisca em vermelho.
 * Cura: uma camada ciano avança na frente, o preenchimento sobe com mola, a barra brilha
 *       em verde e partículas de luz sobem.
 * PV temporário: faixa azul (escudo) sobre a barra.
 * <= 25%: contorno vermelho pulsando como batimento.
 *
 * Tudo roda na UI thread (Reanimated). Com "reduzir movimento" ligado no sistema, tremor,
 * partículas e pulsação são desligados.
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { hud } from '../../theme/theme';
import {
  computeHpTransition,
  CRITICAL_FRACTION,
  fraction,
  HP_TIMING,
  HpSnapshot,
  HpTransition,
  hpAccessibilityText,
  hpLabel,
  shakeKeyframes,
} from './hpBarLogic';
import { LightParticles } from './LightParticles';

const HEAL_COLORS = [hud.healGlow, hud.healLead, '#FFFFFF'];

type Props = {
  current: number;
  max: number;
  temp?: number;
  height?: number;
  showLabel?: boolean;
  accessibilityLabel?: string;
  /** Chamado a cada mudança (haptics/sons ficam a cargo da tela). */
  onTransition?: (transition: HpTransition) => void;
  testID?: string;
};

export function HPBar({
  current,
  max,
  temp = 0,
  height = 24,
  showLabel = true,
  accessibilityLabel = 'Pontos de vida',
  onTransition,
  testID,
}: Props) {
  const reduceMotion = useReducedMotion();
  const initial = fraction(current, max);

  const trackWidth = useSharedValue(0);
  const fill = useSharedValue(initial);
  const bleed = useSharedValue(initial);
  const healLead = useSharedValue(initial);
  const shield = useSharedValue(fraction(temp, max));
  const shake = useSharedValue(0);
  const flash = useSharedValue(0);
  const glow = useSharedValue(0);
  const pulse = useSharedValue(0);

  const [width, setWidth] = useState(0);
  const [burst, setBurst] = useState<{ seed: number; count: number; toX: number } | null>(null);
  const previous = useRef<HpSnapshot>({ current, max, temp });
  const emitTransition = useEffectEvent((t: HpTransition) => onTransition?.(t));

  useEffect(() => {
    const next = { current, max, temp };
    const t = computeHpTransition(previous.current, next);
    previous.current = next;
    shield.value = withTiming(fraction(temp, max), { duration: 300 });

    if (t.kind === 'damage') {
      fill.value = withTiming(t.to, { duration: HP_TIMING.damageDrop, easing: Easing.out(Easing.cubic) });
      healLead.value = t.to;
      bleed.value = withDelay(
        HP_TIMING.bleedHold,
        withTiming(t.to, { duration: HP_TIMING.bleedDrain, easing: Easing.in(Easing.quad) }),
      );
      flash.value = withSequence(withTiming(0.55, { duration: 60 }), withTiming(0, { duration: 420 }));
      const frames = shakeKeyframes(t.shakePx);
      if (!reduceMotion && frames.length > 0) {
        shake.value = withSequence(...frames.map((px) => withTiming(px, { duration: HP_TIMING.shakeStep })));
      }
    } else if (t.kind === 'heal') {
      healLead.value = withTiming(t.to, { duration: HP_TIMING.healLead });
      bleed.value = t.to;
      fill.value = withDelay(HP_TIMING.healLead, withSpring(t.to, { damping: 14, stiffness: 120 }));
      glow.value = withSequence(
        withTiming(0.45, { duration: HP_TIMING.healGlowIn }),
        withTiming(0, { duration: HP_TIMING.healGlowOut }),
      );
      if (!reduceMotion) setBurst({ seed: Date.now(), count: t.particleCount, toX: t.to * width });
    } else {
      // Mudança de PV máximo (subiu de nível) ou só de PV temporário.
      fill.value = withTiming(t.to, { duration: 250 });
      bleed.value = withTiming(t.to, { duration: 250 });
      healLead.value = withTiming(t.to, { duration: 250 });
    }
    if (t.kind !== 'none') emitTransition(t);
    // Só reage a mudanças de valores; shared values são estáveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, max, temp]);

  const critical = max > 0 && current > 0 && current / max <= CRITICAL_FRACTION;
  useEffect(() => {
    if (critical && !reduceMotion) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: HP_TIMING.heartbeat, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: HP_TIMING.heartbeat, easing: Easing.in(Easing.quad) }),
        ),
        -1,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [critical, reduceMotion, pulse]);

  const onLayout = (e: LayoutChangeEvent) => {
    trackWidth.value = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const fillStyle = useAnimatedStyle(() => ({
    width: fill.value * trackWidth.value,
    backgroundColor: interpolateColor(
      fill.value,
      [0, CRITICAL_FRACTION, 0.5, 1],
      [hud.critical, hud.critical, hud.wounded, hud.healthy],
    ),
  }));
  const bleedStyle = useAnimatedStyle(() => ({ width: bleed.value * trackWidth.value }));
  const healStyle = useAnimatedStyle(() => ({ width: healLead.value * trackWidth.value }));
  const shieldStyle = useAnimatedStyle(() => ({ width: shield.value * trackWidth.value }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const radius = height / 2;
  const snapshot = { current, max, temp };

  return (
    <Animated.View
      testID={testID}
      style={[styles.container, containerStyle]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max, now: current, text: hpAccessibilityText(snapshot) }}
    >
      <View style={[styles.track, { height, borderRadius: radius }]} onLayout={onLayout}>
        <Animated.View style={[styles.layer, { backgroundColor: hud.bleed }, bleedStyle]} />
        <Animated.View style={[styles.layer, { backgroundColor: hud.healLead }, healStyle]} />
        <Animated.View style={[styles.layer, fillStyle]}>
          <View style={styles.sheen} />
        </Animated.View>
        <Animated.View style={[styles.shield, shieldStyle]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: hud.healGlow }, glowStyle]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: hud.critical }, flashStyle]} />
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 2, borderColor: hud.critical }, pulseStyle]}
        />
        {showLabel ? (
          <View pointerEvents="none" style={styles.labelWrap}>
            <Text style={[styles.label, { fontSize: Math.max(11, height * 0.55) }]}>{hpLabel(snapshot)}</Text>
          </View>
        ) : null}
      </View>
      {burst ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <LightParticles
            seed={burst.seed}
            count={burst.count}
            fromX={0}
            toX={Math.max(8, burst.toX)}
            baseY={height / 2}
            colors={HEAL_COLORS}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  track: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: hud.track,
    borderWidth: 1,
    borderColor: hud.trackBorder,
  },
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  sheen: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '40%',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  shield: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '30%',
    backgroundColor: hud.shield,
    opacity: 0.85,
  },
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: hud.text,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },
});
