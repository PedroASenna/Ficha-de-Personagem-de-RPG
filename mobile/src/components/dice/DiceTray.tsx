/**
 * Bandeja de dados: arraste (ou toque) para jogar. Os dados quicam nas bordas e entre si
 * (física em worklet na UI thread) e, quando param, mostram o resultado que veio do servidor
 * (ou do motor local, offline) com o efeito da faixa: rachadura e tremor na falha crítica,
 * explosão dourada e confete no crítico.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Button, HelperText, Text, useTheme } from 'react-native-paper';
import Animated, {
  type FrameCallback,
  type FrameInfo,
  SharedValue,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { checkText, diceText } from '../../lib/dice/check';
import { EffectPreset, PALETTES, Tier } from '../../lib/dice/effects';
import { NotationError, parse } from '../../lib/dice/notation';
import { playOutcome, wallTick } from '../../lib/feedback';
import type { RollResponse } from '../../lib/types';
import { DieShape } from './DieShape';
import { OutcomeEffects } from './OutcomeEffects';
import { Body, stepBodies, throwBodies } from './physics';

const MAX_VISIBLE_DICE = 12;
const TIER_LABEL: Record<Tier, string> = {
  critical_failure: 'FALHA CRÍTICA',
  low: 'Baixo',
  neutral: '',
  high: 'Alto!',
  critical_success: 'CRÍTICO!',
};

type TrayDie = { sides: number; value: number | null; kept: boolean };

type Props = {
  /** Dados que aparecem na bandeja (no Savage Worlds inclui o Dado Selvagem: "1d8!+1d6!"). */
  notation: string;
  /** Nome no botão (ex.: "Lutar d8"); sem ele aparece a notação. */
  label?: string;
  roll: (notation: string) => Promise<RollResponse>;
  d6Variant?: 'pips' | 'numeric';
  height?: number;
  disabled?: boolean;
  onResult?: (result: RollResponse) => void;
};

function DieSprite({
  index,
  bodies,
  die,
  size,
  revealed,
  flicker,
  d6Variant,
  palette,
  cracked,
}: {
  index: number;
  bodies: SharedValue<Body[]>;
  die: TrayDie;
  size: number;
  revealed: boolean;
  flicker: number;
  d6Variant: 'pips' | 'numeric';
  palette: (typeof PALETTES)[keyof typeof PALETTES];
  cracked: boolean;
}) {
  const pop = useSharedValue(1);
  useEffect(() => {
    if (revealed) pop.value = withSequence(withTiming(1.35, { duration: 120 }), withSpring(1, { damping: 8 }));
  }, [revealed, pop]);

  const position = useAnimatedStyle(() => {
    const b = bodies.value[index];
    if (!b) return { opacity: 0 };
    return {
      opacity: 1,
      transform: [{ translateX: b.x - size / 2 }, { translateY: b.y - size / 2 }, { rotate: `${b.angle}rad` }, { scale: pop.value }],
    };
  });

  const shown = revealed ? die.value : ((flicker + index * 7) % die.sides) + 1;
  const usePips = die.sides === 6 && d6Variant === 'pips';
  return (
    <Animated.View
      style={[styles.die, { width: size, height: size, opacity: revealed && !die.kept ? 0.35 : 1 }, position]}
      accessible={false}
    >
      <DieShape sides={die.sides} size={size} face={palette.face} edge={palette.edge} pips={usePips ? shown : null} cracked={cracked} />
      {!usePips ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Text style={[styles.dieText, { fontSize: size * (die.sides >= 100 ? 0.26 : 0.34), color: palette.glow }]}>{shown ?? ''}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

export function DiceTray({ label, notation, roll, d6Variant = 'numeric', height = 300, disabled, onResult }: Props) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const bodies = useSharedValue<Body[]>([]);
  const bounds = useSharedValue({ width: 1, height: 1 });
  const shake = useSharedValue(0);
  const [size, setSize] = useState({ width: 0, height });
  const [dice, setDice] = useState<TrayDie[]>([]);
  const [phase, setPhase] = useState<'idle' | 'rolling' | 'revealed'>('idle');
  const [result, setResult] = useState<RollResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flicker, setFlicker] = useState(0);
  const [effectSeed, setEffectSeed] = useState(0);
  const [focus, setFocus] = useState({ x: 0, y: 0 });
  const [throwKey, setThrowKey] = useState(0);

  const pending = useRef<{ settled: boolean; result: RollResponse | null; throwId: number }>({ settled: false, result: null, throwId: 0 });
  const radius = Math.max(22, Math.min(34, size.width / 11));

  const reveal = useCallback(() => {
    const { settled, result: r } = pending.current;
    if (!settled || !r) return;
    const values = r.roll.terms.flatMap((t) => t.dice);
    setDice((current) => current.map((d, i) => ({ ...d, value: values[i]?.value ?? null, kept: values[i]?.kept ?? true })));
    setResult(r);
    setPhase('revealed');
    const keptIndex = Math.max(0, values.findIndex((d) => d.kept));
    const current = bodies.get();
    const b = current[Math.min(keptIndex, current.length - 1)];
    if (b) setFocus({ x: b.x, y: b.y });
    setEffectSeed(Date.now());
    const effect: EffectPreset = r.outcome.effect;
    playOutcome(effect, r.outcome.intensity);
    if (!reduceMotion && effect.shake.px > 0) {
      const steps = 6;
      const dur = effect.shake.ms / steps;
      const px = effect.shake.px;
      shake.set(
        withSequence(
        withTiming(px, { duration: dur }),
        withTiming(-px, { duration: dur }),
        withTiming(px * 0.6, { duration: dur }),
        withTiming(-px * 0.6, { duration: dur }),
        withTiming(px * 0.3, { duration: dur }),
        withTiming(0, { duration: dur }),
        ),
      );
    }
    onResult?.(r);
  }, [bodies, onResult, reduceMotion, shake]);

  // Callbacks estáveis: o loop de física é registrado uma vez só (não a cada render).
  const revealRef = useRef(reveal);
  const frameRef = useRef<FrameCallback | null>(null);
  const onSettled = useCallback(() => {
    pending.current.settled = true;
    frameRef.current?.setActive(false);
    revealRef.current();
  }, []);

  const step = useCallback(
    (info: FrameInfo) => {
      'worklet';
      const dt = (info.timeSincePreviousFrame ?? 16) / 1000;
      const arr = bodies.get();
      const res = stepBodies(arr, dt, bounds.get());
      bodies.set(arr.slice());
      if (res.wallHits > 0) scheduleOnRN(wallTick);
      if (res.settled) scheduleOnRN(onSettled);
    },
    [bodies, bounds, onSettled],
  );
  const frame = useFrameCallback(step, false);
  useLayoutEffect(() => {
    revealRef.current = reveal;
    frameRef.current = frame;
  });

  // Números "girando" enquanto o dado rola.
  useEffect(() => {
    if (phase !== 'rolling') return;
    const id = setInterval(() => setFlicker((f) => f + 1), 90);
    return () => clearInterval(id);
  }, [phase]);

  const throwDice = useCallback(
    (origin: { x: number; y: number }, velocity: { vx: number; vy: number }) => {
      if (disabled || phase === 'rolling' || size.width === 0) return;
      let expr;
      try {
        expr = parse(notation);
      } catch (e) {
        setError(e instanceof NotationError ? e.message : 'Notação inválida.');
        return;
      }
      setError(null);
      const all = expr.terms.flatMap((t) => Array.from({ length: t.count }, () => ({ sides: t.sides as number, value: null, kept: true })));
      const visible = all.slice(0, MAX_VISIBLE_DICE);
      const throwId = pending.current.throwId + 1;
      pending.current = { settled: false, result: null, throwId };
      setThrowKey(throwId);
      bodies.set(throwBodies(visible.length, { width: size.width, height: size.height }, origin, velocity, radius));
      setDice(visible);
      setResult(null);
      setPhase('rolling');
      frame.setActive(true);
      roll(notation)
        .then((r) => {
          if (pending.current.throwId !== throwId) return;
          pending.current.result = r;
          reveal();
        })
        .catch((e: unknown) => {
          if (pending.current.throwId !== throwId) return;
          frame.setActive(false);
          setPhase('idle');
          setError(e instanceof Error ? e.message : 'Falha ao rolar. Tente de novo.');
        });
    },
    [bodies, disabled, frame, notation, phase, radius, reveal, roll, size],
  );

  // Os callbacks do gesto rodam no evento (JS thread via runOnJS), não durante a renderização.
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      // eslint-disable-next-line react-hooks/refs -- chamado só no fim do gesto
      .onEnd((e) => throwDice({ x: e.x, y: e.y }, { vx: e.velocityX, vy: e.velocityY }));
    const tap = Gesture.Tap()
      .runOnJS(true)
      // eslint-disable-next-line react-hooks/refs -- chamado só no toque
      .onEnd((e) => throwDice({ x: e.x, y: e.y }, { vx: 0, vy: 0 }));
    return Gesture.Exclusive(pan, tap);
  }, [throwDice]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    bounds.set({ width, height: h });
    setSize({ width, height: h });
  };

  const trayStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));
  const outcome = result?.outcome;
  const palette = PALETTES[outcome && phase === 'revealed' ? outcome.effect.palette : 'stone'];
  const tierLabel =
    outcome && phase === 'revealed' ? (result?.check ? checkText(result.check) : TIER_LABEL[outcome.tier]) : '';

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <Animated.View
          onLayout={onLayout}
          style={[styles.tray, { height, borderColor: theme.colors.outline, backgroundColor: theme.colors.elevation.level1 }, trayStyle]}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Bandeja de dados. Toque ou arraste para rolar ${label ?? notation}.`}
        >
          {dice.length === 0 ? (
            <Text style={styles.hint} variant="bodyMedium">
              Arraste ou toque para rolar {label ?? notation}
            </Text>
          ) : null}
          {dice.map((die, i) => (
            <DieSprite
              key={`${throwKey}-${i}`}
              index={i}
              bodies={bodies}
              die={die}
              size={radius * 2}
              revealed={phase === 'revealed'}
              flicker={flicker}
              d6Variant={d6Variant}
              palette={palette}
              cracked={phase === 'revealed' && !!outcome?.effect.crack && die.kept}
            />
          ))}
          {outcome && phase === 'revealed' ? (
            <OutcomeEffects
              seed={effectSeed}
              effect={outcome.effect}
              intensity={outcome.intensity}
              width={size.width}
              height={size.height}
              focus={focus}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>

      <View style={styles.footer} accessibilityLiveRegion="polite">
        {result && phase === 'revealed' ? (
          <>
            <Text variant="displaySmall" style={{ color: palette.glow, fontWeight: '800' }}>
              {result.roll.total}
            </Text>
            <View style={styles.breakdown}>
              {tierLabel ? (
                <Text variant="titleMedium" style={{ color: palette.glow }}>
                  {tierLabel}
                </Text>
              ) : null}
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {label ? `${label} · ` : ''}
                {result.roll.notation} · {diceText(result.roll)}
                {result.roll.modifier ? ` ${result.roll.modifier > 0 ? '+' : ''}${result.roll.modifier}` : ''}
              </Text>
            </View>
          </>
        ) : (
          <Button
            mode="contained"
            icon="dice-multiple"
            onPress={() => throwDice({ x: size.width / 2, y: size.height * 0.8 }, { vx: 0, vy: 0 })}
            disabled={disabled || phase === 'rolling'}
            loading={phase === 'rolling'}
          >
            Rolar {label ?? notation}
          </Button>
        )}
      </View>
      {error ? <HelperText type="error">{error}</HelperText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
    opacity: 0.6,
  },
  die: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  dieText: {
    position: 'absolute',
    width: '100%',
    top: '30%',
    textAlign: 'center',
    fontWeight: '900',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingTop: 8,
  },
  breakdown: {
    flex: 1,
  },
});
