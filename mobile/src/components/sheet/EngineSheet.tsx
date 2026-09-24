/**
 * Ficha de GURPS e Savage Worlds: derivadas, perícias, vantagens/complicações e contadores de mesa
 * (PF no GURPS; Benes, Fadiga, Abalado e ferimentos no Savage). Os números vêm prontos do servidor.
 */
import { StyleSheet, View } from 'react-native';
import { Card, Chip, HelperText, IconButton, List, Surface, Text, useTheme } from 'react-native-paper';

import { SEVERITY_LABEL } from '../../lib/build';
import type { Character, GurpsSheet, SavageSheet, SheetDerived } from '../../lib/types';
import { hud } from '../../theme/theme';

type Props = {
  character: Character;
  /** Alterações livres depois de pronta (PF, Benes, Fadiga, Abalado). */
  onPatchBuild: (patch: Record<string, unknown>) => void;
};

function Counter({ item, onChange }: { item: SheetDerived; onChange: (value: number) => void }) {
  const current = item.current ?? Number(item.value);
  return (
    <Surface style={styles.counter} elevation={1}>
      <Text variant="labelMedium">{item.label}</Text>
      <View style={styles.counterRow}>
        <IconButton icon="minus" size={16} onPress={() => onChange(current - 1)} accessibilityLabel={`Gastar ${item.label}`} />
        <Text variant="titleLarge" style={{ fontWeight: '800' }}>
          {current}/{item.value}
        </Text>
        <IconButton icon="plus" size={16} onPress={() => onChange(current + 1)} accessibilityLabel={`Recuperar ${item.label}`} />
      </View>
    </Surface>
  );
}

function DerivedGrid({ items }: { items: SheetDerived[] }) {
  const theme = useTheme();
  return (
    <View style={styles.grid}>
      {items.map((d) => (
        <Surface key={d.key} style={styles.cell} elevation={1}>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
            {d.label}
          </Text>
          <Text variant="titleMedium" style={{ fontWeight: '800', textAlign: 'center' }}>
            {String(d.value)}
          </Text>
        </Surface>
      ))}
    </View>
  );
}

/** Três ferimentos; o quarto incapacita. Usa o PV da ficha (3 = ileso). */
export function WoundTrack({ character }: { character: Character }) {
  const theme = useTheme();
  const wounds = Math.max(0, character.hp_max - character.hp_current);
  const out = character.hp_current <= 0;
  return (
    <View style={styles.wounds} accessibilityLabel={out ? 'Incapacitado' : `${wounds} ferimento(s)`}>
      <Text variant="titleSmall">Ferimentos</Text>
      {Array.from({ length: character.hp_max }, (_, i) => (
        <View
          key={i}
          style={[styles.pip, { borderColor: theme.colors.outline, backgroundColor: i < wounds ? hud.critical : 'transparent' }]}
        >
          <Text style={{ color: i < wounds ? '#fff' : theme.colors.onSurfaceVariant, fontWeight: '800' }}>-{i + 1}</Text>
        </View>
      ))}
      <Chip compact style={{ backgroundColor: out ? hud.critical : undefined }} textStyle={out ? { color: '#fff', fontWeight: '800' } : undefined}>
        {out ? 'INCAPACITADO' : 'Incapacitado'}
      </Chip>
    </View>
  );
}

export function EngineSheet({ character, onPatchBuild }: Props) {
  const theme = useTheme();
  const sheet = character.sheet;
  if (!sheet) return null;
  const counters = sheet.derived.filter((d) => d.current !== undefined);
  const plain = sheet.derived.filter((d) => d.current === undefined);

  return (
    <View style={{ gap: 12 }}>
      {sheet.engine === 'gurps' ? (
        <Surface style={styles.panel} elevation={1}>
          <View style={styles.attrs}>
            {['st', 'dx', 'iq', 'ht'].map((key) => (
              <View key={key} style={styles.attr}>
                <Text variant="labelMedium">{key.toUpperCase()}</Text>
                <Text variant="titleLarge" style={{ fontWeight: '800' }}>
                  {character.attributes[key]}
                </Text>
              </View>
            ))}
          </View>
        </Surface>
      ) : null}
      {sheet.engine === 'savage' ? (
        <Surface style={styles.panel} elevation={1}>
          <View style={styles.attrs}>
            {(sheet as SavageSheet).attributes.map((a) => (
              <View key={a.key} style={styles.attr}>
                <Text variant="labelMedium">{a.name}</Text>
                <Text variant="titleLarge" style={{ fontWeight: '800' }}>
                  {a.label}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.row}>
            <Chip
              icon={sheet.shaken ? 'alert' : 'shield-check-outline'}
              selected={sheet.shaken}
              showSelectedOverlay
              onPress={() => onPatchBuild({ shaken: !sheet.shaken })}
            >
              {sheet.shaken ? 'Abalado' : 'Não abalado'}
            </Chip>
            <Chip icon="sleep" onPress={() => onPatchBuild({ fatigue: (sheet.fatigue + 1) % 3 })}>
              {['Descansado', 'Fatigado (-1)', 'Exausto (-2)'][sheet.fatigue]}
            </Chip>
          </View>
        </Surface>
      ) : null}

      <View style={styles.row}>
        {counters.map((c) => (
          <Counter
            key={c.key}
            item={c}
            onChange={(value) => onPatchBuild(c.key === 'fp' ? { fp_current: value } : { bennies: Math.max(0, value) })}
          />
        ))}
      </View>
      <DerivedGrid items={plain} />

      {sheet.engine === 'gurps' ? (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {(sheet as GurpsSheet).points.total} pontos · {(sheet as GurpsSheet).points.unspent} para gastar
        </Text>
      ) : (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {(sheet as SavageSheet).rank.name} · {(sheet as SavageSheet).xp} XP · {(sheet as SavageSheet).advances.available} Progresso(s) disponível(is)
        </Text>
      )}

      <Card mode="outlined">
        <Card.Title title={sheet.engine === 'gurps' ? 'Perícias e mágicas' : 'Perícias'} subtitle="Role na mesa, em Testes da ficha" />
        <Card.Content>
          {sheet.skills.length === 0 ? <Text style={{ color: theme.colors.onSurfaceVariant }}>Nenhuma perícia.</Text> : null}
          {sheet.skills.map((s) => (
            <View key={`${s.key}-${s.name}`} style={styles.skill}>
              <Text style={{ flex: 1 }}>{s.name}</Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginRight: 8 }}>
                {'relative' in s ? s.relative : s.attribute}
              </Text>
              <Text variant="titleSmall" style={{ fontWeight: '800', minWidth: 36, textAlign: 'right' }}>
                {'level' in s ? s.level : s.label}
              </Text>
            </View>
          ))}
        </Card.Content>
      </Card>

      <Card mode="outlined">
        <Card.Title title={sheet.engine === 'gurps' ? 'Vantagens e desvantagens' : 'Vantagens, Complicações e Poderes'} />
        <Card.Content>
          {sheet.traits.length === 0 ? <Text style={{ color: theme.colors.onSurfaceVariant }}>Nada ainda.</Text> : null}
          {sheet.traits.map((t, i) => (
            <List.Item
              key={`${t.key}-${i}`}
              title={t.name + (t.note ? ` (${t.note})` : '')}
              description={[
                t.cost !== undefined ? `${t.cost > 0 ? '+' : ''}${t.cost} pts` : null,
                t.severity ? `Complicação ${SEVERITY_LABEL[t.severity]}` : t.kind === 'power' ? 'Poder' : t.kind === 'edge' ? 'Vantagem' : null,
                t.info ? Object.entries(t.info).map(([k, v]) => `${k}: ${v}`).join(' · ') : null,
                t.page ? `pág. ${t.page}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              style={{ paddingHorizontal: 0 }}
            />
          ))}
        </Card.Content>
      </Card>

      {sheet.warnings.map((w) => (
        <HelperText key={w} type="info">
          {w}
        </HelperText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 12, borderRadius: 16, gap: 10 },
  attrs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  attr: { alignItems: 'center', minWidth: 58 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '31%', paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
  counter: { flexGrow: 1, alignItems: 'center', paddingTop: 6, borderRadius: 12 },
  counterRow: { flexDirection: 'row', alignItems: 'center' },
  skill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  wounds: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pip: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
