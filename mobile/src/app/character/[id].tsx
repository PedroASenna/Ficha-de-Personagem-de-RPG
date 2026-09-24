/**
 * Ficha dinâmica / HUD de combate: barra de HP animada, dano e cura rápidos, espaços de magia,
 * habilidades com recarga visual (botão cinza até o descanso certo) e carga do inventário.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Dialog,
  HelperText,
  IconButton,
  List,
  Portal,
  ProgressBar,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { HPBar } from '../../components/hud/HPBar';
import { LevelUpDialog } from '../../components/sheet/LevelUpDialog';
import { api, ApiError } from '../../lib/api';
import { absoluteUrl } from '../../lib/config';
import { playHaptic, playHpFeedback } from '../../lib/feedback';
import { keys, useCharacter, useRulesetPack } from '../../lib/queries';
import type { Character } from '../../lib/types';
import { hud } from '../../theme/theme';

const QUICK = [1, 5, 10];
const RECHARGE_LABEL = { short_rest: 'descanso curto', long_rest: 'descanso longo', none: 'sem recarga' } as const;

export default function CharacterSheetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: character, error: loadError } = useCharacter(id);
  const { data: pack } = useRulesetPack(character?.ruleset_id);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [itemDialog, setItemDialog] = useState(false);
  const [abilityDialog, setAbilityDialog] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemWeight, setItemWeight] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [abilityName, setAbilityName] = useState('');
  const [abilityUses, setAbilityUses] = useState('1');
  const [abilityRecharge, setAbilityRecharge] = useState<'short_rest' | 'long_rest'>('long_rest');
  const [levelDialog, setLevelDialog] = useState(false);
  const [leveling, setLeveling] = useState(false);

  const setCached = (c: Character) => queryClient.setQueryData(keys.character(id), c);

  const act = async (fn: () => Promise<Character | void>) => {
    setError(null);
    try {
      const c = await fn();
      if (c) setCached(c);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falhou. Tente de novo.');
      if (e instanceof ApiError && e.status === 409) void queryClient.invalidateQueries({ queryKey: keys.character(id) });
    }
  };

  const changeHp = (kind: 'damage' | 'heal' | 'temp', value: number) =>
    act(async () => {
      if (!character || !value) return;
      const r = await api.changeHp(character.id, value, kind, character.version);
      // Otimista: aplica o resultado do servidor sem recarregar a ficha inteira.
      return { ...character, hp_current: r.hp_current, hp_max: r.hp_max, hp_temp: r.hp_temp, version: r.version };
    });

  if (!character) {
    return (
      <Screen>
        <Text>{loadError ? (loadError as Error).message : 'Carregando ficha…'}</Text>
      </Screen>
    );
  }

  const typed = Number(amount) || 0;
  const loadColor = character.load.encumbered ? hud.critical : character.load.ratio > 0.75 ? hud.wounded : hud.healthy;

  return (
    <>
      <Stack.Screen options={{ title: character.name }} />
      <Screen>
        <View style={styles.header}>
          {character.portrait_url ? (
            <Avatar.Image size={72} source={{ uri: absoluteUrl(character.portrait_url) }} />
          ) : (
            <Avatar.Text size={72} label={character.name.slice(0, 1).toUpperCase()} />
          )}
          <View style={{ flex: 1 }}>
            <Text variant="headlineSmall" style={{ fontWeight: '800' }}>
              {character.name}
            </Text>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              {[character.ancestry_name, character.class_name, `nível ${character.level}`].filter(Boolean).join(' · ')}
            </Text>
            {character.background_name ? <Text style={{ color: theme.colors.onSurfaceVariant }}>{character.background_name}</Text> : null}
          </View>
          {character.status === 'complete' && pack ? (
            <Button mode="contained-tonal" icon="arrow-up-bold-circle" compact onPress={() => setLevelDialog(true)} accessibilityLabel="Subir de nível">
              Nível
            </Button>
          ) : null}
        </View>

        {/* ---- HP ---- */}
        <Surface style={styles.panel} elevation={1}>
          <HPBar current={character.hp_current} max={character.hp_max} temp={character.hp_temp} height={30} onTransition={playHpFeedback} />
          <View style={styles.hpRow}>
            {QUICK.map((n) => (
              <Button key={`d${n}`} mode="contained-tonal" compact buttonColor="#5C1B17" textColor="#FFDAD5" onPress={() => changeHp('damage', n)} accessibilityLabel={`Sofrer ${n} de dano`}>
                −{n}
              </Button>
            ))}
            {QUICK.map((n) => (
              <Button key={`h${n}`} mode="contained-tonal" compact buttonColor="#113B2A" textColor="#B7F5CF" onPress={() => changeHp('heal', n)} accessibilityLabel={`Curar ${n}`}>
                +{n}
              </Button>
            ))}
          </View>
          <View style={styles.hpRow}>
            <TextInput
              mode="outlined"
              dense
              label="Valor"
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              style={{ flex: 1 }}
            />
            <IconButton icon="sword" mode="contained" onPress={() => changeHp('damage', typed)} disabled={!typed} accessibilityLabel="Aplicar dano" />
            <IconButton icon="heart-plus" mode="contained" onPress={() => changeHp('heal', typed)} disabled={!typed} accessibilityLabel="Aplicar cura" />
            <IconButton icon="shield" mode="contained" onPress={() => changeHp('temp', typed)} disabled={!typed} accessibilityLabel="PV temporários" />
          </View>
        </Surface>

        {/* ---- Atributos ---- */}
        <View style={styles.attrs}>
          {pack?.attributes.map((a) => (
            <Surface key={a.key} style={styles.attr} elevation={1}>
              <Text variant="labelMedium">{a.abbr}</Text>
              <Text variant="titleLarge" style={{ fontWeight: '800' }}>
                {character.attributes[a.key]}
              </Text>
              <Text variant="labelMedium" style={{ color: theme.colors.primary }}>
                {(character.modifiers[a.key] ?? 0) >= 0 ? '+' : ''}
                {character.modifiers[a.key]}
              </Text>
            </Surface>
          ))}
        </View>

        {/* ---- Magias ---- */}
        {Object.keys(character.spell_slots).length > 0 ? (
          <Card mode="outlined">
            <Card.Title title="Espaços de magia" subtitle="Toque para gastar; o descanso longo recupera" />
            <Card.Content style={{ gap: 8 }}>
              {Object.entries(character.spell_slots).map(([level, slot]) => (
                <View key={level} style={styles.slotRow}>
                  <Text variant="labelLarge">{level}º círculo</Text>
                  {Array.from({ length: slot.max }, (_, i) => {
                    const used = i < slot.used;
                    return (
                      <IconButton
                        key={i}
                        icon={used ? 'circle-outline' : 'circle'}
                        iconColor={used ? theme.colors.outline : theme.colors.primary}
                        size={22}
                        disabled={used}
                        onPress={() => act(() => api.useSpellSlot(character.id, level))}
                        accessibilityLabel={used ? 'Espaço gasto' : 'Gastar espaço de magia'}
                      />
                    );
                  })}
                </View>
              ))}
            </Card.Content>
          </Card>
        ) : null}

        {/* ---- Habilidades com recarga ---- */}
        <Card mode="outlined">
          <Card.Title title="Habilidades" right={(p) => <IconButton {...p} icon="plus" onPress={() => setAbilityDialog(true)} accessibilityLabel="Adicionar habilidade" />} />
          <Card.Content style={styles.abilities}>
            {character.abilities.length === 0 ? <Text style={{ color: theme.colors.onSurfaceVariant }}>Nenhuma habilidade com usos limitados.</Text> : null}
            {character.abilities.map((ab) => (
              <Button
                key={ab.id}
                mode={ab.available ? 'contained' : 'outlined'}
                disabled={!ab.available}
                icon={ab.available ? 'lightning-bolt' : 'timer-sand'}
                onPress={() => act(() => api.useAbility(character.id, ab.id))}
              >
                {`${ab.name} ${ab.uses_max - ab.uses_spent}/${ab.uses_max}`}
                {!ab.available ? ` · ${RECHARGE_LABEL[ab.recharge]}` : ''}
              </Button>
            ))}
          </Card.Content>
          <Card.Actions>
            <Button icon="weather-sunset" onPress={() => act(() => api.rest(character.id, 'short'))}>
              Descanso curto
            </Button>
            <Button icon="weather-night" mode="contained-tonal" onPress={() => act(() => api.rest(character.id, 'long'))}>
              Descanso longo
            </Button>
          </Card.Actions>
        </Card>

        {/* ---- Inventário e carga ---- */}
        <Card mode="outlined">
          <Card.Title
            title="Inventário"
            subtitle={`Carga ${character.load.total_weight} / ${character.load.capacity} ${character.load.unit}${character.load.encumbered ? ' · SOBRECARREGADO' : ''}`}
            right={(p) => <IconButton {...p} icon="plus" onPress={() => setItemDialog(true)} accessibilityLabel="Adicionar item" />}
          />
          <Card.Content>
            <ProgressBar progress={Math.min(1, character.load.ratio)} color={loadColor} style={{ marginBottom: 8 }} />
            {character.items.map((item) => (
              <List.Item
                key={item.id}
                title={`${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`}
                description={`${Number(item.weight_each) * item.quantity} ${character.load.unit}`}
                right={(p) => <IconButton {...p} icon="delete-outline" onPress={() => act(() => api.removeItem(character.id, item.id))} accessibilityLabel={`Remover ${item.name}`} />}
              />
            ))}
          </Card.Content>
        </Card>

        {character.conditions.length > 0 ? (
          <View style={styles.hpRow}>
            {character.conditions.map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
          </View>
        ) : null}
        {error ? <HelperText type="error">{error}</HelperText> : null}
      </Screen>

      {pack ? (
        <LevelUpDialog
          key={`${character.level}-${levelDialog}`}
          visible={levelDialog}
          character={character}
          pack={pack}
          busy={leveling}
          onDismiss={() => setLevelDialog(false)}
          onConfirm={async (body) => {
            setLeveling(true);
            await act(async () => {
              const updated = await api.levelUp(character.id, { ...body, expected_version: character.version });
              playHaptic('success_heavy');
              setLevelDialog(false);
              return updated;
            });
            setLeveling(false);
          }}
        />
      ) : null}
      <Portal>
        <Dialog visible={itemDialog} onDismiss={() => setItemDialog(false)}>
          <Dialog.Title>Novo item</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <TextInput mode="outlined" label="Nome" value={itemName} onChangeText={setItemName} maxLength={80} />
            <View style={styles.hpRow}>
              <TextInput mode="outlined" label="Qtd." value={itemQty} onChangeText={(t) => setItemQty(t.replace(/\D/g, ''))} keyboardType="number-pad" style={{ flex: 1 }} />
              <TextInput
                mode="outlined"
                label={`Peso (${character.load.unit})`}
                value={itemWeight}
                onChangeText={(t) => setItemWeight(t.replace(',', '.').replace(/[^\d.]/g, ''))}
                keyboardType="decimal-pad"
                style={{ flex: 1 }}
              />
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setItemDialog(false)}>Cancelar</Button>
            <Button
              disabled={!itemName.trim()}
              onPress={() => {
                setItemDialog(false);
                void act(() => api.addItem(character.id, { name: itemName.trim(), quantity: Number(itemQty) || 1, weight_each: itemWeight || '0' }));
                setItemName('');
                setItemWeight('');
                setItemQty('1');
              }}
            >
              Adicionar
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={abilityDialog} onDismiss={() => setAbilityDialog(false)}>
          <Dialog.Title>Nova habilidade</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <TextInput mode="outlined" label="Nome" value={abilityName} onChangeText={setAbilityName} maxLength={80} />
            <TextInput mode="outlined" label="Usos" value={abilityUses} onChangeText={(t) => setAbilityUses(t.replace(/\D/g, ''))} keyboardType="number-pad" />
            <SegmentedButtons
              value={abilityRecharge}
              onValueChange={(v) => setAbilityRecharge(v as typeof abilityRecharge)}
              buttons={[
                { value: 'short_rest', label: 'Desc. curto' },
                { value: 'long_rest', label: 'Desc. longo' },
              ]}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAbilityDialog(false)}>Cancelar</Button>
            <Button
              disabled={!abilityName.trim()}
              onPress={() => {
                setAbilityDialog(false);
                void act(() =>
                  api.addAbility(character.id, { name: abilityName.trim(), level: 0, uses_max: Math.max(1, Number(abilityUses) || 1), recharge: abilityRecharge }),
                );
                setAbilityName('');
              }}
            >
              Adicionar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  panel: { padding: 16, borderRadius: 16, gap: 12 },
  hpRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  attrs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  attr: { width: '31%', alignItems: 'center', paddingVertical: 8, borderRadius: 12 },
  slotRow: { flexDirection: 'row', alignItems: 'center' },
  abilities: { gap: 8 },
});
