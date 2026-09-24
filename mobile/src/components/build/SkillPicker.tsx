/**
 * Perícias (e mágicas do GURPS): busca na lista do livro e, para cada perícia escolhida, os pontos
 * (GURPS: 1, 2, 4, 8...) ou o tipo de dado (Savage: d4 a d12). O NH/dado final vem do servidor.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, IconButton, List, Portal, Searchbar, Surface, Text, TextInput, useTheme } from 'react-native-paper';

import { dieLabel, nextDie, nextSkillPoints, search, skillHint } from '../../lib/build';
import type { EngineSheet, RulesetPack, SkillDef } from '../../lib/types';

export type SkillEntry = { key: string; points?: number; die?: number; note: string };

type Props = {
  pack: RulesetPack;
  entries: SkillEntry[];
  sheet?: EngineSheet | null;
  onChange: (entries: SkillEntry[]) => void;
  /** Savage: dado mínimo por perícia (dado grátis da raça). */
  minDie?: Record<string, number>;
};

export function SkillPicker({ pack, entries, sheet, onChange, minDie = {} }: Props) {
  const theme = useTheme();
  const gurps = pack.engine === 'gurps';
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [asking, setAsking] = useState<SkillDef | null>(null);
  const [note, setNote] = useState('');

  const all = useMemo(() => pack.skills ?? [], [pack.skills]);
  const groups = useMemo(() => [...new Set(all.map((s) => s.category || 'Perícias'))], [all]);
  const results = useMemo(() => search(group ? all.filter((s) => (s.category || 'Perícias') === group) : all, query, 40), [all, group, query]);
  const byKey = useMemo(() => new Map(all.map((s) => [s.key, s])), [all]);
  const attrName = (key: string) =>
    pack.attributes.find((a) => a.key === key)?.[gurps ? 'abbr' : 'name'] ?? ({ will: 'Von', per: 'Per' } as Record<string, string>)[key] ?? key;

  const add = (skill: SkillDef, withNote = '') => {
    const entry: SkillEntry = gurps ? { key: skill.key, points: 1, note: withNote } : { key: skill.key, die: 4, note: withNote };
    onChange([...entries, entry]);
  };

  const computed = (entry: SkillEntry) =>
    sheet?.skills.find((s) => s.key === entry.key && s.name === `${byKey.get(entry.key)?.name}${entry.note ? ` (${entry.note})` : ''}`);

  const change = (index: number, delta: 1 | -1) => {
    const entry = entries[index]!;
    const next = [...entries];
    if (gurps) {
      const points = nextSkillPoints(entry.points ?? 1, delta);
      if (points === 0) return;
      next[index] = { ...entry, points };
    } else {
      next[index] = { ...entry, die: nextDie(entry.die ?? 4, delta, minDie[entry.key] ?? 4) };
    }
    onChange(next);
  };

  return (
    <View style={styles.root}>
      {entries.length === 0 ? <Text style={{ color: theme.colors.onSurfaceVariant }}>Nenhuma perícia ainda.</Text> : null}
      {entries.map((entry, index) => {
        const skill = byKey.get(entry.key);
        if (!skill) return null;
        const info = computed(entry);
        const value = gurps
          ? `${entry.points} pt${entry.points === 1 ? '' : 's'}${info && 'level' in info ? ` · NH ${info.level}` : ''}`
          : dieLabel(entry.die ?? 4);
        const hint = gurps && info && 'relative' in info ? `${info.relative} · ${info.difficulty}` : skillHint(skill, attrName);
        return (
          <Surface key={`${entry.key}-${entry.note}-${index}`} style={styles.row} elevation={1}>
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall">{skill.name + (entry.note ? ` (${entry.note})` : '')}</Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {hint}
              </Text>
            </View>
            <IconButton icon="minus" size={18} onPress={() => change(index, -1)} accessibilityLabel={`Diminuir ${skill.name}`} />
            <Text variant="titleSmall" style={styles.value}>
              {value}
            </Text>
            <IconButton icon="plus" size={18} onPress={() => change(index, 1)} accessibilityLabel={`Aumentar ${skill.name}`} />
            <IconButton
              icon="delete-outline"
              size={18}
              disabled={!gurps && minDie[entry.key] !== undefined}
              onPress={() => onChange(entries.filter((_, i) => i !== index))}
              accessibilityLabel={`Remover ${skill.name}`}
            />
          </Surface>
        );
      })}

      <Searchbar placeholder="Buscar perícia" value={query} onChangeText={setQuery} />
      {groups.length > 1 ? (
        <View style={styles.chips}>
          {groups.map((g) => (
            <Chip key={g} compact selected={group === g} showSelectedOverlay onPress={() => setGroup(group === g ? null : g)}>
              {g}
            </Chip>
          ))}
        </View>
      ) : null}
      {results.map((skill) => {
        const taken = entries.some((e) => e.key === skill.key) && !skill.specialize;
        const onPress = () => (skill.specialize ? (setNote(''), setAsking(skill)) : add(skill));
        return (
          <List.Item
            key={skill.key}
            title={skill.name}
            description={skillHint(skill, attrName) + (skill.specialize ? ' · escolha a especialização' : '')}
            disabled={taken}
            onPress={onPress}
            right={(p) => <IconButton {...p} icon={taken ? 'check' : 'plus-circle-outline'} disabled={taken} onPress={onPress} accessibilityLabel={`Adicionar ${skill.name}`} />}
          />
        );
      })}

      <Portal>
        <Dialog visible={!!asking} onDismiss={() => setAsking(null)}>
          <Dialog.Title>{asking?.name}</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <Text>{gurps ? 'Esta perícia exige especialização.' : 'Escolha o campo (ex.: Conhecimento (Arcano)).'}</Text>
            <TextInput mode="outlined" label="Especialização" value={note} onChangeText={setNote} maxLength={60} autoFocus />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAsking(null)}>Cancelar</Button>
            <Button
              disabled={!note.trim()}
              onPress={() => {
                if (asking) add(asking, note.trim());
                setAsking(null);
              }}
            >
              Adicionar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, borderRadius: 12 },
  value: { minWidth: 72, textAlign: 'center' },
});
