/** Leitura do QR code do painel do Mestre: define o servidor e já entra na mesa depois do login. */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text, useTheme } from 'react-native-paper';

import { Screen } from '../components/common/Screen';
import { connectFromJoinLink } from '../lib/connect';

export default function ScanScreen() {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);

  const onScanned = async ({ data }: { data: string }) => {
    if (handled.current) return;
    handled.current = true;
    setBusy(true);
    const result = await connectFromJoinLink(data);
    setBusy(false);
    if (result.ok) {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } else {
      setError(result.error);
      handled.current = false;
    }
  };

  if (!permission) return <ActivityIndicator style={{ flex: 1 }} />;
  if (!permission.granted) {
    return (
      <Screen>
        <Text variant="titleMedium">Precisamos da câmera para ler o QR code</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant }}>
          A câmera só é usada nesta tela. O QR code aparece no painel do Mestre, em “Conectar celulares”.
        </Text>
        <Button mode="contained" onPress={() => void requestPermission()}>
          Permitir câmera
        </Button>
        <Button onPress={() => router.back()}>Voltar</Button>
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : (result) => void onScanned(result)}
      />
      <View style={[styles.panel, { backgroundColor: theme.colors.surface }]}>
        {busy ? <ActivityIndicator /> : <Text>Aponte para o QR code na tela do Mestre.</Text>}
        {error ? <HelperText type="error">{error}</HelperText> : null}
        <Button onPress={() => router.back()}>Cancelar</Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'black' },
  panel: { position: 'absolute', left: 16, right: 16, bottom: 32, padding: 16, borderRadius: 16, gap: 8, alignItems: 'center' },
});
