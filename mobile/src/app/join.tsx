/** Link rpgplay://join?server=...&pin=...&code=... (QR code lido pela câmera do sistema ou convite /entrar). */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, HelperText, Text } from 'react-native-paper';

import { Screen } from '../components/common/Screen';
import { connectFromJoinLink } from '../lib/connect';

export default function JoinLinkScreen() {
  const { server, pin, code } = useLocalSearchParams<{ server?: string; pin?: string; code?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const link =
      `rpgplay://join?server=${encodeURIComponent(server ?? '')}&pin=${encodeURIComponent(pin ?? '')}` +
      `&code=${encodeURIComponent(code ?? '')}`;
    void connectFromJoinLink(link).then((result) => {
      if (result.ok) router.replace('/');
      else setError(result.error);
    });
  }, [server, pin, code]);

  return (
    <Screen>
      {error ? (
        <>
          <HelperText type="error">{error}</HelperText>
          <Button mode="contained" onPress={() => router.replace('/server')}>
            Escolher servidor
          </Button>
        </>
      ) : (
        <>
          <ActivityIndicator />
          <Text style={{ textAlign: 'center' }}>Conectando na mesa…</Text>
        </>
      )}
    </Screen>
  );
}
