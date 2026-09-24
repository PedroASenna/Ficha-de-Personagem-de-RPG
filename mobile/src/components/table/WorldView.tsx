/**
 * Mapa-múndi para o jogador: a imagem do mundo (se o Mestre liberou) e as fichas das nações e
 * facções já descobertas, com as relações conhecidas entre elas.
 */
import { useMemo, useState } from 'react';
import { Image, type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Avatar, Card, Chip, Text, useTheme } from 'react-native-paper';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { absoluteUrl } from '../../lib/config';
import { fitScale } from '../../lib/table';
import type { PublicFaction, PublicWorld, RelationKind } from '../../lib/types';

const RELATION_LABEL: Record<RelationKind, string> = {
  alliance: 'Aliança',
  friendly: 'Amizade',
  neutral: 'Neutra',
  tense: 'Tensão',
  war: 'Guerra',
};
const RELATION_COLOR: Record<RelationKind, string> = {
  alliance: '#62C370',
  friendly: '#4FB3A9',
  neutral: '#CFC6B8',
  tense: '#E3A13B',
  war: '#E0584A',
};

function ZoomableImage({ uri, width, height }: { uri: string; width: number; height: number }) {
  const [area, setArea] = useState({ width: 0, height: 0 });
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const base = fitScale({ width, height }, area);

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.set(Math.min(6, Math.max(1, savedScale.get() * e.scale)));
      })
      .onEnd(() => {
        savedScale.set(scale.get());
      });
    const pan = Gesture.Pan()
      .minDistance(8)
      .onUpdate((e) => {
        tx.set(savedTx.get() + e.translationX);
        ty.set(savedTy.get() + e.translationY);
      })
      .onEnd(() => {
        savedTx.set(tx.get());
        savedTy.set(ty.get());
      });
    const reset = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        scale.set(withTiming(1));
        tx.set(withTiming(0));
        ty.set(withTiming(0));
        savedScale.set(1);
        savedTx.set(0);
        savedTy.set(0);
      });
    return Gesture.Simultaneous(pinch, pan, reset);
  }, [scale, savedScale, tx, ty, savedTx, savedTy]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }));

  return (
    <View
      style={styles.mapArea}
      onLayout={(e: LayoutChangeEvent) => setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      testID="world-map"
    >
      {area.width > 0 ? (
        <GestureDetector gesture={gesture}>
          <View style={styles.center}>
            <Animated.View style={animated}>
              <Image source={{ uri }} style={{ width: width * base, height: height * base }} accessibilityLabel="Mapa-múndi" />
            </Animated.View>
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

function FactionCard({ faction, parent }: { faction: PublicFaction; parent?: PublicFaction }) {
  const theme = useTheme();
  const subtitle = [faction.kind === 'nation' ? 'Nação' : 'Facção', faction.leader, faction.seat, parent ? `em ${parent.name}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card mode="outlined" style={{ borderLeftWidth: 6, borderLeftColor: faction.color }}>
      <Card.Title
        title={faction.name}
        subtitle={subtitle}
        subtitleNumberOfLines={2}
        left={(props) =>
          faction.emblem_url ? (
            <Avatar.Image {...props} source={{ uri: absoluteUrl(faction.emblem_url) }} />
          ) : (
            <Avatar.Text {...props} label={faction.name.slice(0, 1).toUpperCase()} style={{ backgroundColor: faction.color }} />
          )
        }
      />
      {faction.description ? (
        <Card.Content>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>{faction.description}</Text>
        </Card.Content>
      ) : null}
    </Card>
  );
}

export function WorldView({ world }: { world: PublicWorld | null }) {
  const theme = useTheme();
  const factions = world?.factions ?? [];
  const byId = Object.fromEntries(factions.map((f) => [f.id, f]));
  const hasMap = !!world?.map_url && !!world.map_width && !!world.map_height;

  if (!hasMap && factions.length === 0) {
    return (
      <View style={styles.empty}>
        <Text variant="titleMedium">O mundo ainda é um mistério</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
          Quando o Mestre revelar o mapa-múndi, as nações e as facções, elas aparecem aqui.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {hasMap && world?.map_url ? <ZoomableImage uri={absoluteUrl(world.map_url) ?? ''} width={world.map_width!} height={world.map_height!} /> : null}
      {(['nation', 'faction'] as const).map((kind) => {
        const list = factions.filter((f) => f.kind === kind);
        if (!list.length) return null;
        return (
          <View key={kind} style={{ gap: 8 }}>
            <Text variant="titleMedium">{kind === 'nation' ? 'Nações' : 'Facções'}</Text>
            {list.map((f) => (
              <FactionCard key={f.id} faction={f} parent={f.parent_id ? byId[f.parent_id] : undefined} />
            ))}
          </View>
        );
      })}
      {world && world.relations.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text variant="titleMedium">Relações conhecidas</Text>
          {world.relations.map((r) => (
            <View key={r.id} style={styles.relation}>
              <Text style={{ flex: 1 }}>
                {byId[r.a_id]?.name ?? '?'} ⟷ {byId[r.b_id]?.name ?? '?'}
                {r.note ? `\n${r.note}` : ''}
              </Text>
              <Chip compact style={{ backgroundColor: RELATION_COLOR[r.kind] }} textStyle={{ color: '#14100D', fontWeight: '700' }}>
                {RELATION_LABEL[r.kind]}
              </Chip>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mapArea: { height: 320, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0F0C0A' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 8, padding: 24 },
  relation: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
