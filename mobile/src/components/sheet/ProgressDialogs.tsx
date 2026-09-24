/**
 * Evolução no GURPS (pontos de personagem) e no Savage Worlds (XP e Progressos a cada 5 XP).
 * O Mestre normalmente dá pelo painel; o jogador também pode anotar aqui, como a mesa combinar.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, HelperText, List, Searchbar, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';

import { nextDie, search } from '../../lib/build';
import type { AdvanceChoice, Character, RulesetPack, SavageSheet } from '../../lib/types';

export function ExperienceDialog({
  visible,
  character,
  pack,
  busy,
  onDismiss,
  onConfirm,
}: {
  visible: boolean;
  character: Character;
  pack: RulesetPack;
  busy: boolean;
  onDismiss: () => void;
  onConfirm: (amount: number) => void;
}) {
  const [amount, setAmount] = useState('');
  const gurps = pack.engine === 'gurps';
  const value = Number(amount) || 0;
  return (
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>{gurps ? 'Ganhar pontos de personagem' : 'Ganhar experiência'}</Dialog.Title>
      <Dialog.Content style={{ gap: 8 }}>
        <Text>
          {gurps
            ? 'Os pontos ficam livres para gastar na ficha (atributos, perícias, vantagens ou recomprar desvantagens).'
            : 'O Mestre dá de 1 a 3 XP por sessão. A cada 5 XP, um Progresso.'}
        </Text>
        <View style={styles.chips}>
          {(gurps ? [1, 2, 3, 5, 10] : [1, 2, 3]).map((n) => (
            <Chip key={n} selected={value === n} showSelectedOverlay onPress={() => setAmount(String(n))}>
              +{n}
            </Chip>
          ))}
        </View>
        <TextInput mode="outlined" label={gurps ? 'Pontos' : 'XP'} value={amount} onChangeText={(t) => setAmount(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />
        <Text variant="bodySmall">Hoje: {character.level_label}</Text>
      </Dialog.Content>
      <Dialog.Actions>
        <Button onPress={onDismiss}>Cancelar</Button>
        <Button loading={busy} disabled={busy || value < 1} onPress={() => onConfirm(value)}>
          Confirmar
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
}

const TYPES: { value: AdvanceChoice['type']; label: string }[] = [
  { value: 'edge', label: 'Vantagem' },
  { value: 'attribute', label: 'Atributo' },
  { value: 'skill', label: 'Perícia' },
  { value: 'skills', label: '2 perícias' },
  { value: 'new_skill', label: 'Nova' },
];

const HINT: Record<AdvanceChoice['type'], string> = {
  edge: 'Uma Vantagem nova (precisa cumprir os requisitos e o Estágio).',
  attribute: 'Um atributo sobe um tipo de dado (uma vez por Estágio).',
  skill: 'Uma perícia igual ou acima do atributo associado sobe um tipo de dado.',
  skills: 'Duas perícias abaixo do atributo associado sobem um tipo de dado cada.',
  new_skill: 'Uma perícia nova em d4.',
};

export function AdvanceDialog({
  visible,
  character,
  pack,
  busy,
  onDismiss,
  onConfirm,
}: {
  visible: boolean;
  character: Character;
  pack: RulesetPack;
  busy: boolean;
  onDismiss: () => void;
  onConfirm: (choice: AdvanceChoice) => void;
}) {
  const theme = useTheme();
  const sheet = character.sheet as SavageSheet;
  const [type, setType] = useState<AdvanceChoice['type']>('edge');
  const [key, setKey] = useState<string | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');

  const attrDie = (skillKey: string) => {
    const attr = pack.skills?.find((s) => s.key === skillKey)?.attribute;
    return sheet.attributes.find((a) => a.key === attr)?.die ?? 4;
  };
  const owned = sheet.skills;
  const ownedEdges = new Set(sheet.traits.map((t) => t.key));
  const edges = useMemo(
    () => search((pack.traits ?? []).filter((t) => t.kind === 'edge' && !ownedEdges.has(t.key) && (t.requirements?.rank ?? 0) <= sheet.rank.index), query, 30),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ownedEdges deriva de sheet
    [pack.traits, query, sheet],
  );
  const newSkills = useMemo(() => search((pack.skills ?? []).filter((s) => s.specialize || !owned.some((o) => o.key === s.key)), query, 30), [pack.skills, owned, query]);

  const choose = (value: AdvanceChoice['type']) => {
    setType(value);
    setKey(null);
    setKeys([]);
    setQuery('');
    setNote('');
  };

  const ready =
    (type === 'skills' && keys.length === 2) ||
    (type !== 'skills' && !!key && (type !== 'new_skill' || !pack.skills?.find((s) => s.key === key)?.specialize || !!note.trim()));

  return (
    <Dialog visible={visible} onDismiss={onDismiss} style={{ maxHeight: '90%' }}>
      <Dialog.Title>Progresso ({sheet.advances.available} disponível)</Dialog.Title>
      <Dialog.ScrollArea>
        <View style={{ gap: 10, paddingVertical: 8 }}>
          <SegmentedButtons value={type} onValueChange={(v) => choose(v as AdvanceChoice['type'])} buttons={TYPES} density="small" />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {HINT[type]}
          </Text>
          {type === 'attribute' ? (
            <View style={styles.chips}>
              {sheet.attributes.map((a) => (
                <Chip key={a.key} disabled={a.die >= 12} selected={key === a.key} showSelectedOverlay onPress={() => setKey(a.key)}>
                  {a.name} {a.label} → d{nextDie(a.die, 1)}
                </Chip>
              ))}
            </View>
          ) : null}
          {type === 'skill' || type === 'skills' ? (
            <View style={styles.chips}>
              {owned
                .filter((s) => (type === 'skill' ? s.die >= attrDie(s.key) : s.die < attrDie(s.key)) && s.die < 12)
                .map((s) => {
                  const on = type === 'skill' ? key === s.key : keys.includes(s.key);
                  return (
                    <Chip
                      key={`${s.key}-${s.name}`}
                      selected={on}
                      showSelectedOverlay
                      onPress={() =>
                        type === 'skill' ? setKey(s.key) : setKeys(on ? keys.filter((k) => k !== s.key) : [...keys, s.key].slice(-2))
                      }
                    >
                      {s.name} {s.label} → d{nextDie(s.die, 1)}
                    </Chip>
                  );
                })}
            </View>
          ) : null}
          {type === 'edge' || type === 'new_skill' ? (
            <>
              <Searchbar placeholder={type === 'edge' ? 'Buscar Vantagem' : 'Buscar perícia'} value={query} onChangeText={setQuery} />
              {(type === 'edge' ? edges : newSkills).map((item) => (
                <List.Item
                  key={item.key}
                  title={item.name}
                  description={'requirements' in item ? `${item.requirements?.text ?? ''} · pág. ${item.page}` : `pág. ${item.page}`}
                  onPress={() => setKey(item.key)}
                  left={(p) => <List.Icon {...p} icon={key === item.key ? 'radiobox-marked' : 'radiobox-blank'} />}
                />
              ))}
              {key ? <TextInput mode="outlined" label="Anotação / especialização" value={note} onChangeText={setNote} maxLength={80} /> : null}
            </>
          ) : null}
          {sheet.advances.available < 1 ? <HelperText type="error">Sem Progresso disponível: são 5 XP para cada.</HelperText> : null}
        </View>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Button onPress={onDismiss}>Cancelar</Button>
        <Button
          loading={busy}
          disabled={busy || !ready || sheet.advances.available < 1}
          onPress={() => onConfirm({ type, ...(type === 'skills' ? { keys } : { key: key ?? undefined }), ...(note.trim() ? { note: note.trim() } : {}) })}
        >
          Fazer Progresso
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
