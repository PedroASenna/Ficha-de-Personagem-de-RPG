/** Entrar ou criar conta no servidor da casa (usuário + senha; as contas ficam no servidor). */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { api, ApiError } from '../../lib/api';
import { useServer } from '../../state/server';
import { useSession } from '../../state/session';

const USERNAME = /^[a-z0-9_.-]{3,32}$/;

export default function LoginScreen() {
  const theme = useTheme();
  const setTokens = useSession((s) => s.setTokens);
  const server = useServer((s) => s.server);
  const forgetServer = useServer((s) => s.forget);
  const registrationOpen = server?.registrationOpen ?? true;
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validUser = USERNAME.test(username);
  const canSubmit = validUser && password.length >= (mode === 'register' ? 8 : 1) && (mode === 'login' || name.trim().length >= 2);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const tokens =
        mode === 'login'
          ? await api.login(username, password)
          : await api.register({ username, password, display_name: name.trim() });
      await setTokens(tokens);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.hero}>
        <Text variant="displaySmall" style={{ color: theme.colors.primary, fontWeight: '800' }}>
          RPG Play
        </Text>
        <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
          {server ? `Mesa: ${server.name}` : 'Personagem pronto em minutos.'}
        </Text>
      </View>

      <SegmentedButtons
        value={mode}
        onValueChange={(v) => setMode(v as 'login' | 'register')}
        buttons={[
          { value: 'login', label: 'Entrar' },
          { value: 'register', label: 'Criar conta', disabled: !registrationOpen },
        ]}
      />

      <TextInput
        label="Usuário"
        value={username}
        onChangeText={(t) => setUsername(t.toLowerCase().replace(/\s/g, ''))}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        mode="outlined"
      />
      {mode === 'register' ? (
        <>
          <HelperText type={username && !validUser ? 'error' : 'info'}>
            3 a 32 letras minúsculas, números, ponto, hífen ou _
          </HelperText>
          <TextInput label="Como te chamam na mesa" value={name} onChangeText={setName} maxLength={40} mode="outlined" />
        </>
      ) : null}
      <TextInput
        label="Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        mode="outlined"
      />
      {mode === 'register' ? <HelperText type="info">Mínimo de 8 caracteres.</HelperText> : null}

      {error ? <HelperText type="error">{error}</HelperText> : null}
      <Button mode="contained" onPress={submit} disabled={!canSubmit || busy} loading={busy}>
        {mode === 'login' ? 'Entrar' : 'Criar conta'}
      </Button>
      {!registrationOpen ? (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          O cadastro está fechado neste servidor. Peça para o Mestre liberar ou criar sua conta.
        </Text>
      ) : null}
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        Esqueceu a senha? O dono do servidor pode definir uma nova para você.
      </Text>

      <Button icon="swap-horizontal" onPress={() => void forgetServer()}>
        Trocar servidor{server ? ` (${server.url.replace(/^https?:\/\//, '')})` : ''}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 48, marginBottom: 16, gap: 8 },
});
