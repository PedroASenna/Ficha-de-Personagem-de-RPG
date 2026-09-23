/** Link rpgplay://join?server=...&pin=... (QR code lido pela câmera do sistema). */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, HelperText, Text } from 'react-native-paper';

import { Screen } from '../components/common/Screen';
import { connectFromJoinLink } from '../lib/connect';

export default function JoinLinkScreen() {
  const { server, pin } = useLocalSearchParams<{ server?: string; pin?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const link = `rpgplay://join?server=${encodeURIComponent(server ?? '')}&pin=${encodeURIComponent(pin ?? '')}`;
    void connectFromJoinLink(link).then((result) => {
      if (result.ok) router.replace('/');
      else setError(result.error);
    });
  }, [server, pin]);

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
