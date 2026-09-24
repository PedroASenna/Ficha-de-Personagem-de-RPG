/** Primeira abertura: achar o servidor da casa no Wi-Fi (varredura), digitar o endereço ou ler o QR code. */
import * as Network from 'expo-network';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, List, ProgressBar, Text, TextInput, useTheme } from 'react-native-paper';

import { Screen } from '../components/common/Screen';
import { chooseServer } from '../lib/connect';
import { normalizeServerUrl, probe, scanSubnet, type ServerInfo, unreachableHelp } from '../lib/discovery';

export default function ServerScreen() {
  const theme = useTheme();
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<{ cancelled: boolean } | null>(null);

  /** Varredura em si: só mexe no estado depois de esperar a rede (pode rodar direto do efeito). */
  const runScan = async (signal: { cancelled: boolean }) => {
    try {
      const state = await Network.getNetworkStateAsync();
      if (state.type !== Network.NetworkStateType.WIFI && state.type !== Network.NetworkStateType.ETHERNET) {
        setHint('Conecte o celular no Wi-Fi de casa (o mesmo do servidor) e procure de novo.');
      }
      const ip = await Network.getIpAddressAsync();
      if (!ip || ip === '0.0.0.0') {
        setHint('Não consegui descobrir o IP do celular. Confira o Wi-Fi ou digite o endereço do servidor.');
        return;
      }
      await scanSubnet(ip, {
        signal,
        onFound: (server) => !signal.cancelled && setServers((list) => [...list, server]),
        onProgress: (done, total) => !signal.cancelled && setProgress(done / total),
      });
    } finally {
      if (!signal.cancelled) setScanning(false);
    }
  };

  const startScan = () => {
    if (scanRef.current) scanRef.current.cancelled = true;
    const signal = { cancelled: false };
    scanRef.current = signal;
    return signal;
  };

  const rescan = () => {
    setServers([]);
    setProgress(0);
    setHint(null);
    setScanning(true);
    void runScan(startScan());
  };

  useEffect(() => {
    // Procura uma vez ao abrir a tela; depois, só pelo botão "Procurar".
    const signal = { cancelled: false };
    scanRef.current = signal;
    void runScan(signal);
    return () => {
      signal.cancelled = true;
    };
  }, []);

  const pick = async (server: ServerInfo) => {
    if (scanRef.current) scanRef.current.cancelled = true;
    await chooseServer(server);
  };

  const connectManual = async () => {
    setError(null);
    const url = normalizeServerUrl(address);
    if (!url) {
      setError('Endereço inválido. Exemplo: 192.168.0.20 ou 192.168.0.20:8080');
      return;
    }
    setBusy(true);
    const server = await probe(url, 3000);
    setBusy(false);
    if (server) await pick(server);
    else setError(unreachableHelp(url));
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.hero}>
        <Text variant="displaySmall" style={{ color: theme.colors.primary, fontWeight: '800' }}>
          RPG Play
        </Text>
        <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
          Vamos achar o servidor da mesa aqui no Wi-Fi.
        </Text>
      </View>

      <Button mode="contained" icon="qrcode-scan" onPress={() => router.push('/scan')}>
        Ler QR code do Mestre
      </Button>

      <Card mode="outlined">
        <Card.Title
          title="Servidores na rede"
          subtitle={scanning ? 'Procurando…' : servers.length === 0 ? 'Nenhum encontrado' : `${servers.length} encontrado(s)`}
          right={(props) => (
            <Button {...props} onPress={rescan} disabled={scanning}>
              Procurar
            </Button>
          )}
        />
        {scanning ? <ProgressBar progress={progress} style={styles.progress} /> : null}
        {servers.map((server) => (
          <List.Item
            key={server.serverId}
            title={server.name}
            description={`${server.url} · v${server.version}`}
            left={(props) => <List.Icon {...props} icon="server-network" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => void pick(server)}
          />
        ))}
        {hint ? <HelperText type="info">{hint}</HelperText> : null}
      </Card>

      <Card mode="outlined">
        <Card.Title title="Ou digite o endereço" subtitle="O Mestre vê no painel, em “Conectar celulares”" />
        <Card.Content style={{ gap: 8 }}>
          <TextInput
            mode="outlined"
            label="Endereço do servidor"
            placeholder="192.168.0.20:8080"
            value={address}
            onChangeText={setAddress}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {error ? <HelperText type="error">{error}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button mode="contained-tonal" onPress={() => void connectManual()} loading={busy} disabled={busy || !address.trim()}>
            Conectar
          </Button>
        </Card.Actions>
      </Card>

      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        Não achou? O celular e o servidor precisam estar no mesmo Wi-Fi, e o roteador não pode isolar os aparelhos
        (“isolamento de clientes” ou rede de convidados). No computador do servidor, “sudo rpgplay-server
        diagnostico” mostra o que está bloqueando (quase sempre é o firewall).
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 32, marginBottom: 8, gap: 8 },
  progress: { marginHorizontal: 16, marginBottom: 8 },
});
