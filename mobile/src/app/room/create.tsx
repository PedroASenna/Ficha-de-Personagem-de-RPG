/**
 * O Mestre escolhe o sistema de regras ANTES de criar a sala. Só sistemas com licença
 * compatível com apps ficam selecionáveis; os demais aparecem como "Em breve" ou
 * "Aguardando licença", com a explicação.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, HelperText, RadioButton, Text, TextInput, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { api, ApiError } from '../../lib/api';
import { keys, useRulesets } from '../../lib/queries';
import type { RulesetSummary } from '../../lib/types';

const STATUS_LABEL: Record<RulesetSummary['status'], string> = {
  available: 'Disponível',
  planned: 'Em breve',
  restricted: 'Aguardando licença',
};

export default function CreateRoomScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: rulesets, isLoading } = useRulesets();
  const [rulesetId, setRulesetId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('6');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!rulesetId) return;
    setBusy(true);
    setError(null);
    try {
      const room = await api.createRoom(name.trim(), rulesetId, Math.min(12, Math.max(1, Number(maxPlayers) || 6)));
      await queryClient.invalidateQueries({ queryKey: keys.rooms });
      router.replace({ pathname: '/room/[pin]', params: { pin: room.pin } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível criar a mesa.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text variant="titleLarge">1. Escolha o sistema de regras</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        Ele define raças, classes, atributos e críticos. Todos os personagens da mesa usam o mesmo sistema.
      </Text>
      {isLoading ? <Text>Carregando sistemas…</Text> : null}
      <RadioButton.Group value={rulesetId ?? ''} onValueChange={setRulesetId}>
        {rulesets?.map((r) => {
          const disabled = r.status !== 'available';
          return (
            <Card
              key={r.id}
              mode={rulesetId === r.id ? 'contained' : 'outlined'}
              style={[styles.card, disabled && { opacity: 0.55 }]}
              onPress={disabled ? undefined : () => setRulesetId(r.id)}
              accessibilityState={{ disabled, selected: rulesetId === r.id }}
            >
              <Card.Title
                title={r.name}
                titleNumberOfLines={2}
                subtitle={r.description || r.notes || ''}
                subtitleNumberOfLines={3}
                left={() => <RadioButton value={r.id} disabled={disabled} />}
              />
              <Card.Content style={styles.badges}>
                <Chip compact icon={disabled ? 'lock' : 'check-decagram'}>
                  {STATUS_LABEL[r.status]}
                </Chip>
                <Chip compact icon="scale-balance">
                  {r.license}
                </Chip>
                {r.attribution ? (
                  <Chip compact icon="information-outline" onPress={() => setExpanded(expanded === r.id ? null : r.id)}>
                    Atribuição
                  </Chip>
                ) : null}
              </Card.Content>
              {expanded === r.id ? (
                <Card.Content>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {r.attribution}
                  </Text>
                </Card.Content>
              ) : null}
              {disabled && r.notes ? (
                <Card.Content>
                  <Text variant="bodySmall">{r.notes}</Text>
                </Card.Content>
              ) : null}
            </Card>
          );
        })}
      </RadioButton.Group>

      <Text variant="titleLarge">2. Dê um nome à mesa</Text>
      <TextInput mode="outlined" label="Nome da campanha" value={name} onChangeText={setName} maxLength={60} />
      <TextInput
        mode="outlined"
        label="Máximo de jogadores"
        value={maxPlayers}
        onChangeText={(t) => setMaxPlayers(t.replace(/\D/g, '').slice(0, 2))}
        keyboardType="number-pad"
      />
      {error ? <HelperText type="error">{error}</HelperText> : null}
      <View>
        <Button mode="contained" icon="crown" onPress={create} disabled={!rulesetId || !name.trim() || busy} loading={busy}>
          Criar mesa e gerar PIN
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 10 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
