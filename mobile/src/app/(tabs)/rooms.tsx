import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, Text, TextInput, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { ApiError } from '../../lib/api';
import { joinByPin, openJoined } from '../../lib/joining';
import { keys, useRooms } from '../../lib/queries';
import { useServer } from '../../state/server';

const PIN_CHARS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

function cleanPin(value: string): string {
  return value.toUpperCase().replace(PIN_CHARS, '').slice(0, 6);
}

export default function RoomsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: rooms } = useRooms();
  const params = useLocalSearchParams<{ pin?: string }>();
  const invitePin = useServer((s) => s.invitePin);
  const setInvitePin = useServer((s) => s.setInvitePin);
  const source = params.pin ?? invitePin ?? '';
  const [pin, setPin] = useState(cleanPin(source));
  // A aba fica montada: o PIN de um convite novo (ou do link) chega depois e preenche o campo.
  const [seenSource, setSeenSource] = useState(source);
  if (source !== seenSource) {
    setSeenSource(source);
    if (source) setPin(cleanPin(source));
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await joinByPin(pin);
      await queryClient.invalidateQueries({ queryKey: keys.rooms });
      if (invitePin === pin) setInvitePin(null);
      openJoined(outcome, pin);
      setPin('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {invitePin ? (
        <Card mode="outlined">
          <Card.Title title={`Convite para a mesa ${invitePin}`} subtitle="Entre agora ou crie o personagem antes" />
          <Card.Content>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Sua conta já está pronta. Se quiser, crie o personagem primeiro; o PIN fica guardado aqui. Ao entrar, o
              Mestre pode precisar aceitar.
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button onPress={() => setInvitePin(null)}>Agora não</Button>
            <Button mode="contained-tonal" icon="account-plus" onPress={() => router.push('/character/new')}>
              Criar personagem
            </Button>
          </Card.Actions>
        </Card>
      ) : null}

      <Card mode="contained">
        <Card.Title title="Entrar numa mesa" subtitle="Peça o PIN de 6 caracteres ao Mestre" />
        <Card.Content style={{ gap: 8 }}>
          <TextInput
            mode="outlined"
            label="PIN da sala"
            value={pin}
            onChangeText={(t) => setPin(cleanPin(t))}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.pin}
            maxLength={6}
          />
          {error ? <HelperText type="error">{error}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button mode="contained" onPress={join} disabled={pin.length !== 6 || busy} loading={busy}>
            Entrar
          </Button>
        </Card.Actions>
      </Card>

      <Button mode="contained-tonal" icon="qrcode-scan" onPress={() => router.push('/scan')}>
        Ler QR code da mesa
      </Button>

      <Button mode="text" icon="crown" onPress={() => router.push('/room/create')}>
        Sou o Mestre: criar mesa pelo celular
      </Button>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: -8 }}>
        Para o mapa, as cenas e os inimigos, o Mestre usa o programa RPG Play Mestre no PC.
      </Text>

      {rooms && rooms.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text variant="titleMedium">Minhas mesas abertas</Text>
          {rooms.map((room) => (
            <Card key={room.id} onPress={() => router.push({ pathname: '/room/[pin]', params: { pin: room.pin } })}>
              <Card.Title
                title={room.name}
                subtitle={`${room.my_role === 'master' ? 'Mestre' : 'Jogador'} · ${room.ruleset_name} · PIN ${room.pin}`}
              />
            </Card>
          ))}
        </View>
      ) : (
        <Text style={{ color: theme.colors.onSurfaceVariant }}>Você ainda não está em nenhuma mesa.</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pin: { fontSize: 28, letterSpacing: 8, textAlign: 'center' },
});
