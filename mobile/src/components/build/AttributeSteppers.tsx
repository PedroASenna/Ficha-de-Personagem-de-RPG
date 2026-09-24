/**
 * Atributos da ficha de pontos: GURPS (ST/DX/IQ/HT, características secundárias e pontos iniciais) e
 * Savage Worlds (d4 a d12, começando no dado que a raça dá).
 */
import { StyleSheet, View } from 'react-native';
import { Chip, IconButton, Surface, Text, useTheme } from 'react-native-paper';

import { nextDie } from '../../lib/build';
import type { GurpsBuild, GurpsSheet, RulesetPack, SavageBuild, SavageSheet } from '../../lib/types';

const GURPS_COST: Record<string, number> = { st: 10, dx: 20, iq: 20, ht: 10 };
const SECONDARY: { key: keyof GurpsBuild['secondary']; label: string; cost: number; unit?: string }[] = [
  { key: 'hp', label: 'Pontos de Vida', cost: 2 },
  { key: 'will', label: 'Vontade', cost: 5 },
  { key: 'per', label: 'Percepção', cost: 5 },
  { key: 'fp', label: 'Pontos de Fadiga', cost: 3 },
  { key: 'speed', label: 'Velocidade Básica', cost: 5, unit: '×0,25' },
  { key: 'move', label: 'Deslocamento', cost: 5 },
];
const STARTING = [100, 125, 150, 200, 250];

function Stepper({ label, value, hint, onMinus, onPlus }: { label: string; value: string; hint?: string; onMinus: () => void; onPlus: () => void }) {
  const theme = useTheme();
  return (
    <Surface style={styles.stepperRow} elevation={1}>
      <View style={{ flex: 1 }}>
        <Text variant="titleSmall">{label}</Text>
        {hint ? (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <IconButton icon="minus" size={18} onPress={onMinus} accessibilityLabel={`Diminuir ${label}`} />
      <Text variant="titleMedium" style={styles.value}>
        {value}
      </Text>
      <IconButton icon="plus" size={18} onPress={onPlus} accessibilityLabel={`Aumentar ${label}`} />
    </Surface>
  );
}

export function GurpsAttributes({
  pack,
  build,
  sheet,
  editableStart,
  onChange,
}: {
  pack: RulesetPack;
  build: GurpsBuild;
  sheet?: GurpsSheet;
  editableStart: boolean;
  onChange: (patch: Partial<GurpsBuild>) => void;
}) {
  const theme = useTheme();
  const derived = Object.fromEntries((sheet?.derived ?? []).map((d) => [d.key, d.value]));
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <View style={styles.root}>
      {editableStart ? (
        <>
          <Text variant="titleSmall">Pontos iniciais (o Mestre define o nível da campanha)</Text>
          <View style={styles.chips}>
            {STARTING.map((p) => (
              <Chip key={p} selected={build.points === p} showSelectedOverlay onPress={() => onChange({ points: p })}>
                {p}
              </Chip>
            ))}
          </View>
        </>
      ) : null}
      <Text variant="titleSmall">Atributos (10 é a média humana)</Text>
      {pack.attributes.map((a) => {
        const value = build.attributes[a.key] ?? 10;
        const cost = (value - 10) * (GURPS_COST[a.key] ?? 10);
        return (
          <Stepper
            key={a.key}
            label={`${a.name} (${a.abbr})`}
            value={String(value)}
            hint={`${GURPS_COST[a.key]} pts/nível · ${signed(cost)} pts`}
            onMinus={() => onChange({ attributes: { ...build.attributes, [a.key]: Math.max(1, value - 1) } })}
            onPlus={() => onChange({ attributes: { ...build.attributes, [a.key]: Math.min(30, value + 1) } })}
          />
        );
      })}
      <Text variant="titleSmall">Características secundárias</Text>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        Saem dos atributos; compre ou venda níveis a mais.
      </Text>
      {SECONDARY.map((s) => {
        const bought = build.secondary[s.key] ?? 0;
        const shown = derived[s.key];
        return (
          <Stepper
            key={s.key}
            label={s.label}
            value={shown !== undefined ? String(shown) : signed(bought)}
            hint={`${s.cost} pts por ${s.unit ?? 'nível'} · comprado ${signed(bought)} (${signed(bought * s.cost)} pts)`}
            onMinus={() => onChange({ secondary: { ...build.secondary, [s.key]: bought - 1 } })}
            onPlus={() => onChange({ secondary: { ...build.secondary, [s.key]: bought + 1 } })}
          />
        );
      })}
    </View>
  );
}

export function SavageAttributes({
  pack,
  build,
  start,
  onChange,
}: {
  pack: RulesetPack;
  build: SavageBuild;
  start: Record<string, number>;
  onChange: (patch: Partial<SavageBuild>) => void;
}) {
  return (
    <View style={styles.root}>
      {pack.attributes.map((a) => {
        const die = build.attributes[a.key] ?? 4;
        const min = start[a.key] ?? 4;
        return (
          <Stepper
            key={a.key}
            label={a.name}
            value={`d${die}`}
            hint={min > 4 ? `Começa em d${min} pela raça` : 'Começa em d4'}
            onMinus={() => onChange({ attributes: { ...build.attributes, [a.key]: nextDie(die, -1, min) } })}
            onPlus={() => onChange({ attributes: { ...build.attributes, [a.key]: nextDie(die, 1, min) } })}
          />
        );
      })}
    </View>
  );
}

/** Quanto sobra: pontos (GURPS) ou orçamento da criação (Savage), sempre à vista. */
export function BuildBudget({ sheet }: { sheet: GurpsSheet | SavageSheet | null | undefined }) {
  const theme = useTheme();
  if (!sheet) return null;
  const good = theme.colors.primary;
  const bad = theme.colors.error;
  if (sheet.engine === 'gurps') {
    const p = sheet.points;
    return (
      <Surface style={styles.budget} elevation={2}>
        <Text variant="titleMedium" style={{ color: p.unspent < 0 ? bad : good, fontWeight: '800' }}>
          {p.unspent} de {p.total} pontos livres
        </Text>
        <Text variant="bodySmall">
          Desvantagens {p.disadvantages} (limite {p.disadvantage_limit}) · Peculiaridades {p.quirks}/{p.quirk_limit}
        </Text>
      </Surface>
    );
  }
  const c = sheet.creation;
  const hindranceLeft = c.hindrances.points - c.hindrances.spent;
  return (
    <Surface style={styles.budget} elevation={2}>
      <Text variant="bodyMedium">
        Atributos {c.attributes.spent}/{c.attributes.budget} · Perícias {c.skills.spent}/{c.skills.budget} · Vantagens {c.edges.taken}
        {c.edges.free ? ` (${c.edges.free} grátis)` : ''}
      </Text>
      <Text variant="bodySmall" style={{ color: hindranceLeft < 0 ? bad : good }}>
        Pontos de Complicação: {c.hindrances.spent} usados de {c.hindrances.points}
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, borderRadius: 12 },
  value: { minWidth: 44, textAlign: 'center', fontWeight: '800' },
  budget: { padding: 12, borderRadius: 12, gap: 2 },
});
