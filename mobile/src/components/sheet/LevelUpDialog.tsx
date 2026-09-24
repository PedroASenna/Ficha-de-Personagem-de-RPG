/** Subir de nível pela ficha: PV (automáticos ou digitados) e os pontos de atributo do nível. */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, HelperText, IconButton, Portal, Text, TextInput, useTheme } from 'react-native-paper';

import { nextLevel, pointsValid } from '../../lib/levelUp';
import type { Character, RulesetPack } from '../../lib/types';

type Props = {
  visible: boolean;
  character: Character;
  pack: RulesetPack;
  busy: boolean;
  onDismiss: () => void;
  onConfirm: (body: { attributes: Record<string, number>; hp_gain: number | null }) => void;
};

export function LevelUpDialog({ visible, character, pack, busy, onDismiss, onConfirm }: Props) {
  const theme = useTheme();
  const rules = nextLevel(pack, character.level);
  const [hp, setHp] = useState('');
  const [points, setPoints] = useState<Record<string, number>>({});
  const spent = Object.values(points).reduce((sum, v) => sum + v, 0);

  const bump = (key: string, delta: number) => {
    const current = points[key] ?? 0;
    const next = Math.max(0, current + delta);
    const score = (character.attributes[key] ?? 0) + next;
    if (delta > 0 && (spent >= rules.points || (rules.attributeMax !== null && score > rules.attributeMax))) return;
    setPoints({ ...points, [key]: next });
  };

  const confirm = () =>
    onConfirm({
      attributes: Object.fromEntries(Object.entries(points).filter(([, v]) => v > 0)),
      hp_gain: rules.hpAutomatic ? null : Number(hp) || 0,
    });

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>
          Nível {character.level} → {rules.next}
        </Dialog.Title>
        <Dialog.Content style={{ gap: 10 }}>
          {rules.atMax ? (
            <Text>Seu personagem já está no nível máximo deste sistema.</Text>
          ) : (
            <>
              {rules.hpAutomatic ? (
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Os PV do novo nível são calculados pela classe e pela Constituição.</Text>
              ) : (
                <TextInput
                  mode="outlined"
                  label="PV ganhos neste nível"
                  value={hp}
                  onChangeText={(t) => setHp(t.replace(/\D/g, '').slice(0, 3))}
                  keyboardType="number-pad"
                />
              )}
              {rules.points > 0 ? (
                <>
                  <Text variant="titleSmall">
                    {rules.free
                      ? `Pontos de atributo combinados com a mesa: ${spent} (até ${rules.points})`
                      : `Distribua ${rules.points} pontos de atributo: ${spent}/${rules.points}`}
                  </Text>
                  <View style={styles.grid}>
                    {pack.attributes.map((a) => (
                      <View key={a.key} style={[styles.cell, { borderColor: theme.colors.outlineVariant }]}>
                        <Text variant="labelMedium">
                          {a.abbr} {(character.attributes[a.key] ?? 0) + (points[a.key] ?? 0)}
                        </Text>
                        <View style={styles.stepper}>
                          <IconButton icon="minus" size={14} onPress={() => bump(a.key, -1)} accessibilityLabel={`Tirar ponto de ${a.name}`} />
                          <Text>+{points[a.key] ?? 0}</Text>
                          <IconButton icon="plus" size={14} onPress={() => bump(a.key, 1)} accessibilityLabel={`Dar ponto a ${a.name}`} />
                        </View>
                      </View>
                    ))}
                  </View>
                  {!rules.free && spent === 0 ? <HelperText type="info">Vai pegar um talento no lugar? Pode subir sem distribuir.</HelperText> : null}
                </>
              ) : (
                <Text style={{ color: theme.colors.onSurfaceVariant }}>O nível {rules.next} não dá pontos de atributo neste sistema.</Text>
              )}
            </>
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Cancelar</Button>
          <Button mode="contained" loading={busy} disabled={busy || rules.atMax || !pointsValid(rules, spent)} onPress={confirm}>
            Subir para o nível {rules.next}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: { width: '31%', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
});
