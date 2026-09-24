/**
 * Raça/origem digitada pelo jogador (sistemas livres): o nome e os pontos de atributo que ela dá,
 * dentro dos limites do sistema (ex.: de -5 a +5 em cada atributo).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Surface, Text, TextInput, useTheme } from 'react-native-paper';

import type { RulesetPack } from '../../lib/types';

type Props = {
  label: string;
  pack: RulesetPack;
  initialName: string;
  initialPoints: Record<string, number>;
  busy: boolean;
  onSave: (name: string, points: Record<string, number>) => void;
};

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function CustomChoice({ label, pack, initialName, initialPoints, busy, onSave }: Props) {
  const theme = useTheme();
  const [name, setName] = useState(initialName);
  const [points, setPoints] = useState<Record<string, number>>(initialPoints);
  const rule = pack.custom_bonus;
  const total = Object.values(points).reduce((sum, v) => sum + v, 0);

  const step = (key: string, delta: number) => {
    if (!rule) return;
    const next = Math.min(rule.max, Math.max(rule.min, (points[key] ?? 0) + delta));
    setPoints({ ...points, [key]: next });
  };

  return (
    <Surface style={styles.root} elevation={1}>
      <TextInput mode="outlined" label={`${label} (digite)`} value={name} onChangeText={setName} maxLength={60} placeholder="Ex.: Androide, Meio-dragão, Nômade do deserto" />
      {rule ? (
        <>
          <Text variant="titleSmall">Pontos de atributo de {label.toLowerCase()}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            De {rule.min} a {signed(rule.max)} em cada atributo, como a mesa combinar. Total: {signed(total)}
          </Text>
          <View style={styles.grid}>
            {pack.attributes.map((a) => (
              <View key={a.key} style={[styles.cell, { borderColor: theme.colors.outlineVariant }]}>
                <Text variant="labelLarge">{a.abbr}</Text>
                <View style={styles.stepper}>
                  <IconButton icon="minus" size={16} onPress={() => step(a.key, -1)} accessibilityLabel={`Tirar ponto de ${a.name}`} />
                  <Text variant="titleMedium" style={{ minWidth: 26, textAlign: 'center' }}>
                    {signed(points[a.key] ?? 0)}
                  </Text>
                  <IconButton icon="plus" size={16} onPress={() => step(a.key, +1)} accessibilityLabel={`Dar ponto a ${a.name}`} />
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}
      <Button
        mode="contained"
        icon="content-save"
        loading={busy}
        disabled={busy || !name.trim()}
        onPress={() => onSave(name.trim(), Object.fromEntries(Object.entries(points).filter(([, v]) => v !== 0)))}
      >
        Salvar {label.toLowerCase()}
      </Button>
    </Surface>
  );
}

const styles = StyleSheet.create({
  root: { padding: 12, borderRadius: 12, gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '31%', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingVertical: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
});
