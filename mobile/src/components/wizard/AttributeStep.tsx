/**
 * Passo de atributos. "Automático" usa a prioridade da classe (1 toque). Também há arranjo padrão
 * (toque em dois atributos para trocar), compra de pontos, rolagem no servidor e valores manuais.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, IconButton, SegmentedButtons, Surface, Text, useTheme } from 'react-native-paper';

import { PALETTES } from '../../lib/dice/effects';
import { playHaptic } from '../../lib/feedback';
import type { AttributeMethod, Character, RulesetPack } from '../../lib/types';

type Props = {
  pack: RulesetPack;
  character: Character;
  busy: boolean;
  onGenerate: (method: AttributeMethod, scores?: Record<string, number>) => Promise<Character | void>;
};

const mod = (score: number) => Math.floor((score - 10) / 2);
const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function AttributeStep({ pack, character, busy, onGenerate }: Props) {
  const theme = useTheme();
  const keys = pack.attributes.map((a) => a.key);
  const gen = pack.generation;
  const cls = pack.classes.find((c) => c.key === character.class_key);

  const methods = useMemo(() => {
    const list: { value: AttributeMethod; label: string }[] = [];
    if (gen.standard_array && cls) list.push({ value: 'class_preset', label: 'Auto' });
    if (gen.roll) list.push({ value: 'roll', label: 'Rolar' });
    if (gen.standard_array) list.push({ value: 'standard_array', label: 'Arranjo' });
    if (gen.point_buy) list.push({ value: 'point_buy', label: 'Pontos' });
    list.push({ value: 'manual', label: 'Manual' });
    return list;
  }, [gen, cls]);

  // Valores iniciais de cada método editável.
  const initialScores = (m: AttributeMethod): Record<string, number> => {
    if (m === 'standard_array' && gen.standard_array) {
      const order = cls?.attribute_priority ?? keys;
      const sorted = [...gen.standard_array].sort((a, b) => b - a);
      return Object.fromEntries(order.map((k, i) => [k, sorted[i] ?? 8]));
    }
    if (m === 'point_buy' && gen.point_buy) {
      const min = Math.min(...Object.keys(gen.point_buy.costs).map(Number));
      return Object.fromEntries(keys.map((k) => [k, min]));
    }
    return Object.fromEntries(keys.map((k) => [k, character.attribute_audit.base?.[k] ?? 10]));
  };

  const [method, setMethod] = useState<AttributeMethod>(methods[0]?.value ?? 'manual');
  const [scores, setScores] = useState<Record<string, number>>(() => initialScores(methods[0]?.value ?? 'manual'));
  const [swapFrom, setSwapFrom] = useState<string | null>(null);

  const selectMethod = (m: AttributeMethod) => {
    setMethod(m);
    setScores(initialScores(m));
    setSwapFrom(null);
  };

  const spent = gen.point_buy ? keys.reduce((s, k) => s + (gen.point_buy!.costs[String(scores[k])] ?? 0), 0) : 0;
  const allowedBuy = gen.point_buy ? Object.keys(gen.point_buy.costs).map(Number).sort((a, b) => a - b) : [];

  const step = (k: string, delta: number) => {
    const current = scores[k] ?? 10;
    if (method === 'point_buy') {
      const idx = allowedBuy.indexOf(current) + delta;
      const next = allowedBuy[idx];
      if (next !== undefined) setScores({ ...scores, [k]: next });
    } else {
      setScores({ ...scores, [k]: Math.min(gen.manual.max, Math.max(gen.manual.min, current + delta)) });
    }
  };

  const tapSwap = (k: string) => {
    if (!swapFrom) return setSwapFrom(k);
    if (swapFrom !== k) setScores({ ...scores, [swapFrom]: scores[k]!, [k]: scores[swapFrom]! });
    setSwapFrom(null);
  };

  const generate = async () => {
    const result = await onGenerate(method, ['standard_array', 'point_buy', 'manual'].includes(method) ? scores : undefined);
    if (method === 'roll' && result) {
      const totals = (result.attribute_audit.rolls ?? []).map((r) => r.total);
      if (totals.some((t) => t >= 17)) playHaptic('success_heavy');
      else if (totals.some((t) => t <= 6)) playHaptic('error_heavy');
    }
  };

  const editable = method === 'standard_array' || method === 'point_buy' || method === 'manual';
  const rolls = character.attribute_method === 'roll' ? (character.attribute_audit.rolls ?? []) : [];

  return (
    <View style={styles.root}>
      <SegmentedButtons value={method} onValueChange={(v) => selectMethod(v as AttributeMethod)} buttons={methods} density="small" />
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {method === 'class_preset' && `Distribui ${gen.standard_array?.join(', ')} priorizando o que um(a) ${cls?.name ?? 'personagem'} mais usa.`}
        {method === 'roll' && `Rola ${gen.roll} para cada atributo (no servidor) e distribui pelos pontos fortes da classe.`}
        {method === 'standard_array' && 'Toque em dois atributos para trocar os valores.'}
        {method === 'point_buy' && `Orçamento: ${gen.point_buy?.budget} pontos. Restam ${(gen.point_buy?.budget ?? 0) - spent}.`}
        {method === 'manual' && `Valores de ${gen.manual.min} a ${gen.manual.max}.`}
      </Text>

      {editable ? (
        <View style={styles.grid}>
          {pack.attributes.map((a) => {
            const v = scores[a.key] ?? 10;
            const selected = swapFrom === a.key;
            return (
              <Surface key={a.key} style={[styles.cell, selected && { borderColor: theme.colors.primary, borderWidth: 2 }]} elevation={1}>
                <Text variant="labelLarge">{a.abbr}</Text>
                {method === 'standard_array' ? (
                  <Button mode={selected ? 'contained' : 'text'} onPress={() => tapSwap(a.key)} accessibilityLabel={`${a.name} ${v}`}>
                    {v}
                  </Button>
                ) : (
                  <View style={styles.stepper}>
                    <IconButton icon="minus" size={16} onPress={() => step(a.key, -1)} accessibilityLabel={`Diminuir ${a.name}`} />
                    <Text variant="titleMedium">{v}</Text>
                    <IconButton icon="plus" size={16} onPress={() => step(a.key, +1)} accessibilityLabel={`Aumentar ${a.name}`} />
                  </View>
                )}
              </Surface>
            );
          })}
        </View>
      ) : null}

      <Button mode="contained" icon={method === 'roll' ? 'dice-multiple' : 'check'} onPress={generate} loading={busy} disabled={busy || (method === 'point_buy' && spent > (gen.point_buy?.budget ?? 0))}>
        {method === 'class_preset' ? 'Gerar automaticamente' : method === 'roll' ? `Rolar ${gen.roll} × ${keys.length}` : 'Aplicar'}
      </Button>
      {method === 'point_buy' && spent > (gen.point_buy?.budget ?? 0) ? <HelperText type="error">Passou do orçamento.</HelperText> : null}

      {rolls.length > 0 ? (
        <View style={styles.rolls}>
          {rolls.map((r, i) => {
            const color = r.total >= 17 ? PALETTES.gold.edge : r.total <= 6 ? PALETTES.blood.edge : undefined;
            return (
              <Chip key={i} compact textStyle={color ? { color, fontWeight: '800' } : undefined}>
                {`${r.total} [${r.terms[0]?.dice.map((d) => (d.kept ? d.value : `(${d.value})`)).join(' ')}]`}
              </Chip>
            );
          })}
        </View>
      ) : null}

      {Object.keys(character.attributes).length > 0 ? (
        <View style={styles.grid}>
          {pack.attributes.map((a) => {
            const v = character.attributes[a.key] ?? 0;
            const bonus = character.attribute_audit.bonuses?.[a.key];
            return (
              <Surface key={a.key} style={styles.cell} elevation={2}>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                  {a.name}
                </Text>
                <Text variant="headlineSmall" style={{ fontWeight: '800' }}>
                  {v}
                </Text>
                <Text variant="labelMedium" style={{ color: theme.colors.primary }}>
                  {fmt(character.modifiers[a.key] ?? mod(v))}
                  {bonus ? ` · ${fmt(bonus)} bônus` : ''}
                </Text>
              </Surface>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '31%', alignItems: 'center', paddingVertical: 8, borderRadius: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  rolls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
