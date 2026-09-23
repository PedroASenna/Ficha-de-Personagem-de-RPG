/**
 * Mapa da cena para o jogador: só olhar. Pinça para zoom, arrastar para mover, toque duplo volta ao
 * enquadramento, toque num boneco mostra quem é. Quem move os bonecos é o Mestre, no PC.
 */
import { useCallback, useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from 'react-native-paper';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, G, Image as SvgImage, Path, Rect, Text as SvgText } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { absoluteUrl } from '../../lib/config';
import { fitScale, gridPath, screenToMap, tokenAt, tokenRadius } from '../../lib/table';
import type { PartyMember, PublicNpc, Scene, TableToken } from '../../lib/types';

const PARTY_RING = '#4FB3A9';
const ENEMY_RING = '#E0584A';
const MINE_RING = '#F2C14E';
const MAX_ZOOM = 6;

type Props = {
  scene: Scene;
  tokens: TableToken[];
  npcs: Record<string, PublicNpc>;
  party: PartyMember[];
  myCharacterId?: string | null;
  selectedId?: string | null;
  onSelect: (token: TableToken | null) => void;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function TokenShape({
  token,
  grid,
  label,
  image,
  ring,
  selected,
  dim,
}: {
  token: TableToken;
  grid: number;
  label: string;
  image?: string;
  ring: string;
  selected: boolean;
  dim: boolean;
}) {
  const r = tokenRadius(token.size, grid);
  const stroke = Math.max(3, r * 0.1);
  const font = Math.max(12, Math.min(22, grid * 0.24));
  const clipId = `clip-${token.id}`;
  return (
    <G x={token.x} y={token.y} opacity={dim ? 0.55 : 1}>
      {selected ? <Circle r={r + stroke * 2.2} fill="none" stroke={MINE_RING} strokeWidth={stroke * 0.8} /> : null}
      <Circle r={r} fill="#2A221C" />
      {image ? (
        <>
          <Defs>
            <ClipPath id={clipId}>
              <Circle r={r - stroke / 2} />
            </ClipPath>
          </Defs>
          <SvgImage
            href={{ uri: image }}
            x={-r}
            y={-r}
            width={2 * r}
            height={2 * r}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
        </>
      ) : (
        <SvgText y={r * 0.25} fontSize={r * 0.7} fontWeight="bold" fill="#F3E3BF" textAnchor="middle">
          {initials(label)}
        </SvgText>
      )}
      <Circle r={r} fill="none" stroke={ring} strokeWidth={stroke} />
      <SvgText
        y={r + font * 1.1}
        fontSize={font}
        fontWeight="bold"
        fill="#FFF8E6"
        stroke="#14100D"
        strokeWidth={font * 0.18}
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </G>
  );
}

export function SceneView({ scene, tokens, npcs, party, myCharacterId, selectedId, onSelect }: Props) {
  const theme = useTheme();
  const [area, setArea] = useState({ width: 0, height: 0 });
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const map = useMemo(() => ({ width: scene.map_width, height: scene.map_height }), [scene.map_width, scene.map_height]);
  const base = fitScale(map, area);
  const grid = useMemo(
    () => (scene.grid_visible ? gridPath(scene.map_width, scene.map_height, scene.grid_size) : ''),
    [scene.grid_visible, scene.map_width, scene.map_height, scene.grid_size],
  );

  const handleTap = useCallback(
    (x: number, y: number, currentTx: number, currentTy: number, currentScale: number) => {
      const point = screenToMap({ x, y }, map, area, { tx: currentTx, ty: currentTy, scale: currentScale });
      onSelect(tokenAt(point, tokens, scene.grid_size));
    },
    [map, area, tokens, scene.grid_size, onSelect],
  );

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.set(Math.min(MAX_ZOOM, Math.max(1, savedScale.get() * e.scale)));
      })
      .onEnd(() => {
        savedScale.set(scale.get());
      });
    const pan = Gesture.Pan()
      .minDistance(8)
      .averageTouches(true)
      .onUpdate((e) => {
        tx.set(savedTx.get() + e.translationX);
        ty.set(savedTy.get() + e.translationY);
      })
      .onEnd(() => {
        savedTx.set(tx.get());
        savedTy.set(ty.get());
      });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        scale.set(withTiming(1));
        tx.set(withTiming(0));
        ty.set(withTiming(0));
        savedScale.set(1);
        savedTx.set(0);
        savedTy.set(0);
      });
    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((e) => {
        scheduleOnRN(handleTap, e.x, e.y, tx.get(), ty.get(), scale.get());
      });
    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, tap));
  }, [handleTap, scale, savedScale, tx, ty, savedTx, savedTy]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
  };

  const partyById = useMemo(() => Object.fromEntries(party.map((p) => [p.id, p])), [party]);

  return (
    <View style={[styles.root, { backgroundColor: '#0F0C0A' }]} onLayout={onLayout} testID="scene-view">
      {area.width > 0 ? (
        <GestureDetector gesture={gesture}>
          <View style={styles.fill}>
            <Animated.View style={[{ width: map.width * base, height: map.height * base }, animated]}>
              <Svg width={map.width * base} height={map.height * base} viewBox={`0 0 ${map.width} ${map.height}`}>
                {scene.map_url ? (
                  <SvgImage href={{ uri: absoluteUrl(scene.map_url) }} width={map.width} height={map.height} preserveAspectRatio="none" />
                ) : (
                  <Rect width={map.width} height={map.height} fill="#3B3026" />
                )}
                {grid ? <Path d={grid} stroke="rgba(15,10,6,0.45)" strokeWidth={1 / base} /> : null}
                <Rect width={map.width} height={map.height} fill="none" stroke={theme.colors.primary} strokeOpacity={0.35} strokeWidth={2 / base} />
                {tokens.map((token) => {
                  const member = token.character_id ? partyById[token.character_id] : undefined;
                  const npc = token.npc_id ? npcs[token.npc_id] : undefined;
                  const mine = !!myCharacterId && token.character_id === myCharacterId;
                  return (
                    <TokenShape
                      key={token.id}
                      token={token}
                      grid={scene.grid_size}
                      label={member?.name ?? npc?.name ?? '?'}
                      image={absoluteUrl(member?.portrait_url ?? npc?.portrait_url)}
                      ring={mine ? MINE_RING : npc ? ENEMY_RING : PARTY_RING}
                      selected={selectedId === token.id}
                      dim={npc?.condition === 'caido' || (member ? member.hp_current <= 0 : false)}
                    />
                  );
                })}
              </Svg>
            </Animated.View>
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
