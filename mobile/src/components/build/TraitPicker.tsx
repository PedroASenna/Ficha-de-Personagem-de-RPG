/**
 * Vantagens, desvantagens, peculiaridades (GURPS), Complicações, Vantagens e Poderes (Savage Worlds):
 * a lista do livro com busca e filtro, e o que o personagem já tem em cima. Nome, custo e página; o texto
 * da regra fica no livro.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, HelperText, IconButton, List, Portal, Searchbar, SegmentedButtons, Surface, Text, TextInput, useTheme } from 'react-native-paper';

import { costLabel, kindLabel, previewCost, search, SEVERITY_LABEL, traitNeedsSetup } from '../../lib/build';
import type { RulesetPack, SheetTrait, TraitDef, TraitKind } from '../../lib/types';

/** Entrada da ficha (GURPS e Savage usam campos diferentes; o servidor valida). */
export type TraitEntry = {
  key: string;
  level?: number;
  per?: number | null;
  base_cost?: number | null;
  self_control?: number | null;
  severity?: 'minor' | 'major' | null;
  source?: 'creation' | 'advance' | 'race';
  note: string;
};

type Props = {
  pack: RulesetPack;
  kinds: TraitKind[];
  /** Todas as entradas da ficha (de todos os tipos); a lista mostra só as destes tipos. */
  entries: TraitEntry[];
  /** Como o servidor calculou (nome com nível, custo, requisitos que faltam). */
  computed?: SheetTrait[];
  onChange: (entries: TraitEntry[]) => void;
  emptyText?: string;
};

function describe(trait: TraitDef): string {
  const parts: string[] = [];
  if (trait.cost) parts.push(`${costLabel(trait.cost)} pts`);
  if (trait.severity) parts.push(SEVERITY_LABEL[trait.severity]);
  if (trait.requirements?.text) parts.push(trait.requirements.text);
  if (trait.info && Object.keys(trait.info).length) parts.push(Object.entries(trait.info).map(([k, v]) => `${k}: ${v}`).join(' · '));
  if (trait.category && !trait.requirements) parts.push(trait.category);
  if (trait.tags.length) parts.push(trait.tags.join(', '));
  if (trait.page) parts.push(`pág. ${trait.page}`);
  return parts.join(' · ');
}

export function TraitPicker({ pack, kinds, entries, computed = [], onChange, emptyText }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ trait: TraitDef; entry: TraitEntry; index: number | null } | null>(null);

  const candidates = useMemo(() => (pack.traits ?? []).filter((t) => kinds.includes(t.kind)), [pack.traits, kinds]);
  const categories = useMemo(() => [...new Set(candidates.map((t) => t.category).filter(Boolean))], [candidates]);
  const results = useMemo(
    () => search(category ? candidates.filter((t) => t.category === category) : candidates, query, 40),
    [candidates, category, query],
  );
  const byKey = useMemo(() => new Map((pack.traits ?? []).map((t) => [t.key, t])), [pack.traits]);
  const mine = entries.map((entry, index) => ({ entry, index, trait: byKey.get(entry.key) })).filter((x) => x.trait && kinds.includes(x.trait.kind));

  const add = (trait: TraitDef) => {
    const entry: TraitEntry = { key: trait.key, note: '', ...(trait.cost?.per_level.length ? { level: 1 } : {}) };
    if (traitNeedsSetup(trait)) setEditing({ trait, entry, index: null });
    else onChange([...entries, entry]);
  };

  const save = (entry: TraitEntry) => {
    if (!editing) return;
    const next = [...entries];
    if (editing.index === null) next.push(entry);
    else next[editing.index] = entry;
    onChange(next);
    setEditing(null);
  };

  return (
    <View style={styles.root}>
      {mine.length === 0 ? <Text style={{ color: theme.colors.onSurfaceVariant }}>{emptyText ?? 'Nada escolhido ainda.'}</Text> : null}
      {mine.map(({ entry, index, trait }) => {
        const info = computed.find((c) => c.key === entry.key && (c.note ?? '') === (entry.note ?? ''));
        const locked = entry.source === 'race' || entry.source === 'advance';
        const detail = [
          info?.cost !== undefined ? `${info.cost > 0 ? '+' : ''}${info.cost} pts` : null,
          entry.severity ? SEVERITY_LABEL[entry.severity] : trait!.severity && trait!.severity !== 'either' ? SEVERITY_LABEL[trait!.severity] : null,
          entry.source === 'race' ? 'da raça' : entry.source === 'advance' ? 'Progresso' : null,
          entry.note || null,
          trait!.page ? `pág. ${trait!.page}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Surface key={`${entry.key}-${index}`} style={styles.chosen} elevation={1}>
            <List.Item
              title={info?.name ?? trait!.name}
              description={detail}
              onPress={locked ? undefined : () => setEditing({ trait: trait!, entry, index })}
              right={(p) =>
                locked ? (
                  <IconButton {...p} icon="lock-outline" disabled accessibilityLabel="Não dá para remover" />
                ) : (
                  <IconButton {...p} icon="delete-outline" onPress={() => onChange(entries.filter((_, i) => i !== index))} accessibilityLabel={`Remover ${trait!.name}`} />
                )
              }
            />
            {info?.unmet?.length ? (
              <HelperText type="error" style={styles.helper}>
                Falta: {info.unmet.join(', ')}
              </HelperText>
            ) : null}
            {info?.check?.length ? (
              <HelperText type="info" style={styles.helper}>
                Confira com o Mestre: {info.check.join(', ')}
              </HelperText>
            ) : null}
          </Surface>
        );
      })}

      <Searchbar placeholder="Buscar na lista do livro" value={query} onChangeText={setQuery} />
      {categories.length > 1 ? (
        <View style={styles.chips}>
          {categories.map((c) => (
            <Chip key={c} compact selected={category === c} showSelectedOverlay onPress={() => setCategory(category === c ? null : c)}>
              {c}
            </Chip>
          ))}
        </View>
      ) : null}
      {results.map((trait) => (
        <List.Item
          key={trait.key}
          title={trait.name}
          description={describe(trait)}
          descriptionNumberOfLines={2}
          onPress={() => add(trait)}
          right={(p) => <IconButton {...p} icon="plus-circle-outline" onPress={() => add(trait)} accessibilityLabel={`Adicionar ${trait.name}`} />}
        />
      ))}
      {results.length === 0 ? <Text style={{ color: theme.colors.onSurfaceVariant }}>Nada com esse nome.</Text> : null}

      <Portal>
        {editing ? <TraitDialog trait={editing.trait} initial={editing.entry} onCancel={() => setEditing(null)} onSave={save} /> : null}
      </Portal>
    </View>
  );
}

function TraitDialog({ trait, initial, onCancel, onSave }: { trait: TraitDef; initial: TraitEntry; onCancel: () => void; onSave: (entry: TraitEntry) => void }) {
  const theme = useTheme();
  const [entry, setEntry] = useState<TraitEntry>(initial);
  const [typed, setTyped] = useState(initial.base_cost != null ? String(initial.base_cost) : '');
  const cost = trait.cost;
  const negative = trait.kind === 'disadvantage' || trait.kind === 'quirk';
  const typedCost = cost && cost.fixed === null && !cost.per_level.length;
  const parsed = typed.trim() === '' || typed.trim() === '-' ? null : Number(typed);
  const current = { ...entry, base_cost: typedCost ? (Number.isFinite(parsed) ? parsed : null) : entry.base_cost };
  const preview = previewCost(trait, current);
  const needsNote = trait.name.endsWith('(descreva)');
  const ok = (!typedCost || current.base_cost !== null) && (trait.severity !== 'either' || !!entry.severity) && (!needsNote || entry.note.trim().length > 0);

  return (
    <Dialog visible onDismiss={onCancel}>
      <Dialog.Title>{trait.name.replace(' (descreva)', '')}</Dialog.Title>
      <Dialog.ScrollArea>
        <View style={{ gap: 10, paddingVertical: 8 }}>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {kindLabel(trait.kind)} · {describe(trait)}
          </Text>
          {trait.severity === 'either' ? (
            <SegmentedButtons
              value={entry.severity ?? ''}
              onValueChange={(v) => setEntry({ ...entry, severity: v as 'minor' | 'major' })}
              buttons={[
                { value: 'minor', label: 'Menor (1 ponto)' },
                { value: 'major', label: 'Maior (2 pontos)' },
              ]}
            />
          ) : null}
          {cost?.per_level.length ? (
            <>
              {cost.per_level.length > 1 ? (
                <SegmentedButtons
                  value={String(entry.per ?? cost.per_level[0])}
                  onValueChange={(v) => setEntry({ ...entry, per: Number(v) })}
                  buttons={cost.per_level.map((p) => ({ value: String(p), label: `${p}/${cost.unit ?? 'nível'}` }))}
                />
              ) : null}
              <View style={styles.stepper}>
                <Text variant="titleSmall">{cost.unit ? `Quantidade (${cost.unit})` : 'Nível'}</Text>
                <IconButton icon="minus" onPress={() => setEntry({ ...entry, level: Math.max(1, (entry.level ?? 1) - 1) })} accessibilityLabel="Diminuir nível" />
                <Text variant="titleMedium">{entry.level ?? 1}</Text>
                <IconButton icon="plus" onPress={() => setEntry({ ...entry, level: Math.min(100, (entry.level ?? 1) + 1) })} accessibilityLabel="Aumentar nível" />
              </View>
            </>
          ) : null}
          {typedCost ? (
            cost!.options.length ? (
              <View style={styles.chips}>
                {cost!.options.map((o) => (
                  <Chip key={o} selected={current.base_cost === o} showSelectedOverlay onPress={() => setTyped(String(o))}>
                    {o} pts
                  </Chip>
                ))}
              </View>
            ) : (
              <TextInput
                mode="outlined"
                label={`Custo em pontos (${costLabel(cost)})`}
                value={typed}
                onChangeText={(t) => setTyped(t.replace(/[^\d-]/g, '').slice(0, 5))}
                keyboardType="numbers-and-punctuation"
                placeholder={negative ? 'Ex.: -10' : 'Ex.: 10'}
              />
            )
          ) : null}
          {cost?.self_control ? (
            <>
              <Text variant="titleSmall">Autocontrole (resiste com 3d6 até o número)</Text>
              <SegmentedButtons
                value={String(entry.self_control ?? 12)}
                onValueChange={(v) => setEntry({ ...entry, self_control: Number(v) })}
                buttons={[6, 9, 12, 15].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </>
          ) : null}
          <TextInput
            mode="outlined"
            label={needsNote ? 'Descreva' : 'Anotação (opcional)'}
            value={entry.note}
            onChangeText={(note) => setEntry({ ...entry, note })}
            maxLength={80}
            placeholder={trait.kind === 'hindrance' ? 'Ex.: medo de aranhas' : 'Ex.: especialização, alvo, detalhe'}
          />
          {preview !== null && cost ? <Text variant="titleSmall">Custo: {preview > 0 ? `+${preview}` : preview} pontos</Text> : null}
        </View>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Button onPress={onCancel}>Cancelar</Button>
        <Button disabled={!ok} onPress={() => onSave({ ...current, note: entry.note.trim() })}>
          Salvar
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chosen: { borderRadius: 12 },
  helper: { marginTop: -8, marginLeft: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
