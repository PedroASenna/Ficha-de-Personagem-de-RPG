/** Sala de espera: a mesa pede aprovação e o jogador espera o Mestre aceitar (pergunta a cada 3 s). */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { api, ApiError } from '../../lib/api';
import { keys } from '../../lib/queries';

const POLL_MS = 3000;

export default function WaitingScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { pin = '' } = useLocalSearchParams<{ pin?: string }>();
  const [state, setState] = useState<'pending' | 'denied' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const status = await api.joinStatus(pin);
        if (stopped) return;
        if (status.status === 'approved' && status.room) {
          await queryClient.invalidateQueries({ queryKey: keys.rooms });
          router.replace({ pathname: '/room/[pin]', params: { pin: status.room.pin } });
          return;
        }
        if (status.status === 'denied') {
          setState('denied');
          return;
        }
        setError(null);
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiError && e.status === 404) {
          // A mesa foi arquivada ou o pedido expirou.
          setState('error');
          setError(e.message);
          return;
        }
        // Sem internet por um instante: continua tentando.
        setError(e instanceof ApiError ? e.message : 'Sem conexão com o servidor. Tentando de novo…');
      }
      timer = setTimeout(() => void check(), POLL_MS);
    };
    void check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [pin, queryClient]);

  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 16, marginTop: 48 }}>
        {state === 'pending' ? (
          <>
            <ActivityIndicator size="large" />
            <Text variant="headlineSmall" style={{ textAlign: 'center' }}>
              Esperando o Mestre
            </Text>
            <Text style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
              Seu pedido para entrar na mesa {pin} foi enviado. Assim que o Mestre aceitar, a mesa abre sozinha.
            </Text>
          </>
        ) : state === 'denied' ? (
          <>
            <Text variant="headlineSmall" style={{ textAlign: 'center' }}>
              Entrada não aceita
            </Text>
            <Text style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
              O Mestre não aceitou sua entrada nesta mesa. Fale com ele antes de tentar de novo.
            </Text>
          </>
        ) : null}
        {error ? <HelperText type={state === 'error' ? 'error' : 'info'}>{error}</HelperText> : null}
        <Button mode={state === 'pending' ? 'text' : 'contained'} onPress={() => router.replace('/rooms')}>
          {state === 'pending' ? 'Voltar (o pedido continua)' : 'Voltar às mesas'}
        </Button>
      </View>
    </Screen>
  );
}
