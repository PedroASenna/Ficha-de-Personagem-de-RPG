import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, Text, TextInput, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { api, ApiError } from '../../lib/api';
import { keys, useRooms } from '../../lib/queries';

const PIN_CHARS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

export default function RoomsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: rooms } = useRooms();
  const params = useLocalSearchParams<{ pin?: string }>();
  const [pin, setPin] = useState((params.pin ?? '').toUpperCase().replace(PIN_CHARS, '').slice(0, 6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await api.joinRoom(pin);
      await queryClient.invalidateQueries({ queryKey: keys.rooms });
      router.push({ pathname: '/room/[pin]', params: { pin: room.pin } });
      setPin('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card mode="contained">
        <Card.Title title="Entrar numa mesa" subtitle="Peça o PIN de 6 caracteres ao Mestre" />
        <Card.Content style={{ gap: 8 }}>
          <TextInput
            mode="outlined"
            label="PIN da sala"
            value={pin}
            onChangeText={(t) => setPin(t.toUpperCase().replace(PIN_CHARS, '').slice(0, 6))}
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
