/**
 * Testes da ficha: toque numa perícia ou atributo e a bandeja rola do jeito certo para o sistema
 * (GURPS: 3d6 contra o NH; Savage Worlds: dado da perícia + Dado Selvagem). O modificador da situação
 * vai no NH (GURPS) ou na rolagem (Savage).
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, IconButton, Text, useTheme } from 'react-native-paper';

import type { SheetCheck } from '../../lib/types';

export type ActiveCheck = { check: SheetCheck; modifier: number };

/** O que a bandeja mostra e o que vai ao servidor para um teste escolhido. */
export function checkRequest({ check, modifier }: ActiveCheck): {
  display: string;
  notation: string;
  target?: number;
  wild: boolean;
  label: string;
} {
  const signed = modifier ? ` (${modifier > 0 ? '+' : ''}${modifier})` : '';
  if (check.wild !== undefined && check.notation.includes('!')) {
    const notation = modifier ? `${check.notation}${modifier > 0 ? '+' : ''}${modifier}` : check.notation;
    return { display: check.wild ? `${notation}+1d6!` : notation, notation, target: check.target, wild: !!check.wild, label: `${check.label}${signed}` };
  }
  const target = check.target === undefined ? undefined : check.target + modifier;
  return { display: check.notation, notation: check.notation, target, wild: false, label: `${check.label}${target !== undefined ? ` ${target}` : ''}` };
}

export function CheckPicker({ checks, active, onChange }: { checks: SheetCheck[]; active: ActiveCheck | null; onChange: (active: ActiveCheck | null) => void }) {
  const theme = useTheme();
  const groups = useMemo(() => {
    const map = new Map<string, SheetCheck[]>();
    for (const c of checks) map.set(c.group, [...(map.get(c.group) ?? []), c]);
    return [...map.entries()];
  }, [checks]);
  const valueOf = (c: SheetCheck) => (c.notation.includes('!') ? c.notation.replace(/^1/, '').replace('!', '') : String(c.target ?? ''));

  return (
    <View style={styles.root}>
      {groups.map(([group, items]) => (
        <View key={group} style={{ gap: 4 }}>
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {group}
          </Text>
          <View style={styles.chips}>
            {items.map((c) => {
              const on = active?.check.key === c.key && active.check.label === c.label;
              return (
                <Chip key={`${c.key}-${c.label}`} compact selected={on} showSelectedOverlay onPress={() => onChange(on ? null : { check: c, modifier: 0 })}>
                  {c.label} {valueOf(c)}
                </Chip>
              );
            })}
          </View>
        </View>
      ))}
      {active ? (
        <View style={styles.modifier}>
          <Text>Modificador da situação</Text>
          <IconButton icon="minus" size={18} onPress={() => onChange({ ...active, modifier: active.modifier - 1 })} accessibilityLabel="Penalidade" />
          <Text variant="titleMedium" style={{ minWidth: 28, textAlign: 'center' }}>
            {active.modifier > 0 ? `+${active.modifier}` : active.modifier}
          </Text>
          <IconButton icon="plus" size={18} onPress={() => onChange({ ...active, modifier: active.modifier + 1 })} accessibilityLabel="Bônus" />
          <Chip compact icon="close" onPress={() => onChange(null)}>
            Rolagem livre
          </Chip>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modifier: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
