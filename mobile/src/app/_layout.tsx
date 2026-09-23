import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { api } from '../lib/api';
import { initFeedback } from '../lib/feedback';
import { useServer } from '../state/server';
import { useSession } from '../state/session';
import { darkTheme, lightTheme } from '../theme/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = scheme === 'light' ? lightTheme : darkTheme;
  const navTheme = scheme === 'light' ? DefaultTheme : DarkTheme;
  const status = useSession((s) => s.status);
  const restore = useSession((s) => s.restore);
  const setUser = useSession((s) => s.setUser);
  const serverStatus = useServer((s) => s.status);
  const hasServer = useServer((s) => s.server !== null);
  const restoreServer = useServer((s) => s.restore);
  const pendingPin = useServer((s) => s.pendingPin);
  const setPendingPin = useServer((s) => s.setPendingPin);

  useEffect(() => {
    void restoreServer();
    void restore();
    void initFeedback();
  }, [restore, restoreServer]);

  const signedIn = status === 'signedIn' && hasServer;

  useEffect(() => {
    if (signedIn) {
      api
        .me()
        .then(setUser)
        .catch(() => undefined);
    }
  }, [signedIn, setUser]);

  // PIN do QR code do Mestre: entra na mesa assim que houver login.
  useEffect(() => {
    if (!signedIn || !pendingPin) return;
    setPendingPin(null);
    api
      .joinRoom(pendingPin)
      .then((room) => router.push({ pathname: '/room/[pin]', params: { pin: room.pin } }))
      .catch(() => router.push({ pathname: '/rooms', params: { pin: pendingPin } }));
  }, [signedIn, pendingPin, setPendingPin]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider
              value={{
                ...navTheme,
                colors: { ...navTheme.colors, background: theme.colors.background, card: theme.colors.surface, primary: theme.colors.primary },
              }}
            >
              <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
              {status === 'loading' || serverStatus === 'loading' ? (
                <ActivityIndicator style={{ flex: 1 }} />
              ) : (
                <Stack screenOptions={{ headerTintColor: theme.colors.onSurface, headerStyle: { backgroundColor: theme.colors.surface } }}>
                  <Stack.Protected guard={signedIn}>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="character/new" options={{ title: 'Novo personagem' }} />
                    <Stack.Screen name="character/[id]" options={{ title: 'Ficha' }} />
                    <Stack.Screen name="room/create" options={{ title: 'Criar mesa' }} />
                    <Stack.Screen name="room/[pin]" options={{ title: 'Mesa' }} />
                  </Stack.Protected>
                  <Stack.Protected guard={hasServer && !signedIn}>
                    <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
                  </Stack.Protected>
                  <Stack.Protected guard={!hasServer}>
                    <Stack.Screen name="server" options={{ headerShown: false }} />
                  </Stack.Protected>
                  {/* Sempre disponíveis: ler o QR code e abrir o link rpgplay://join. */}
                  <Stack.Screen name="scan" options={{ title: 'Ler QR code', headerShown: false }} />
                  <Stack.Screen name="join" options={{ title: 'Entrando na mesa' }} />
                </Stack>
              )}
            </ThemeProvider>
          </QueryClientProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
