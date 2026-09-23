import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar, Button, Card, Dialog, HelperText, Portal, RadioButton, Text, TextInput, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { HPBar } from '../../components/hud/HPBar';
import { api, ApiError } from '../../lib/api';
import { absoluteUrl } from '../../lib/config';
import { keys, useCharacters, useRulesets } from '../../lib/queries';

export default function CharactersScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: characters, isLoading, error } = useCharacters();
  const { data: rulesets } = useRulesets();
  const available = (rulesets ?? []).filter((r) => r.status === 'available');

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickRuleset, setQuickRuleset] = useState('srd-5.2');
  const [busy, setBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  const quickCreate = async () => {
    setBusy(true);
    setQuickError(null);
    try {
      const character = await api.quickCreate({ ruleset_id: quickRuleset, name: quickName.trim() });
      await queryClient.invalidateQueries({ queryKey: keys.characters });
      setQuickOpen(false);
      setQuickName('');
      router.push({ pathname: '/character/[id]', params: { id: character.id } });
    } catch (e) {
      setQuickError(e instanceof ApiError ? e.message : 'Não foi possível criar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.actions}>
        <Button mode="contained" icon="flash" onPress={() => setQuickOpen(true)} style={styles.flex}>
          Criação expressa
        </Button>
        <Button mode="outlined" icon="auto-fix" onPress={() => router.push('/character/new')} style={styles.flex}>
          Passo a passo
        </Button>
      </View>

      {isLoading ? <Text>Carregando…</Text> : null}
      {error ? <HelperText type="error">{(error as Error).message}</HelperText> : null}
      {characters?.length === 0 ? (
        <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
          Nenhum personagem ainda. A criação expressa monta um herói jogável em um toque.
        </Text>
      ) : null}

      {characters?.map((c) => (
        <Card
          key={c.id}
          mode="elevated"
          onPress={() =>
            c.status === 'complete'
              ? router.push({ pathname: '/character/[id]', params: { id: c.id } })
              : router.push({ pathname: '/character/new', params: { draftId: c.id } })
          }
        >
          <Card.Title
            title={c.name || 'Sem nome'}
            subtitle={c.status === 'draft' ? `Rascunho · passo ${c.wizard_step + 1}` : [c.ancestry_name, c.class_name, `nível ${c.level}`].filter(Boolean).join(' · ')}
            left={(props) =>
              c.portrait_url ? (
                <Avatar.Image {...props} source={{ uri: absoluteUrl(c.portrait_url) }} />
              ) : (
                <Avatar.Text {...props} label={(c.name || '?').slice(0, 1).toUpperCase()} />
              )
            }
          />
          {c.status === 'complete' ? (
            <Card.Content>
              <HPBar current={c.hp_current} max={c.hp_max} temp={c.hp_temp} height={16} />
            </Card.Content>
          ) : null}
        </Card>
      ))}

      <Portal>
        <Dialog visible={quickOpen} onDismiss={() => setQuickOpen(false)}>
          <Dialog.Title>Criação expressa</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <Text variant="bodyMedium">Raça e classe sorteadas, atributos distribuídos pela classe. Dá para editar depois.</Text>
            <TextInput label="Nome do personagem" value={quickName} onChangeText={setQuickName} maxLength={60} mode="outlined" />
            <RadioButton.Group value={quickRuleset} onValueChange={setQuickRuleset}>
              {available.map((r) => (
                <RadioButton.Item key={r.id} value={r.id} label={r.name} position="leading" />
              ))}
            </RadioButton.Group>
            {quickError ? <HelperText type="error">{quickError}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setQuickOpen(false)}>Cancelar</Button>
            <Button onPress={quickCreate} disabled={!quickName.trim() || busy} loading={busy}>
              Criar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});
