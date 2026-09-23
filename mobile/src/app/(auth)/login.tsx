import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Checkbox, HelperText, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { api, ApiError } from '../../lib/api';
import { PRIVACY_POLICY_URL, TERMS_URL } from '../../lib/config';
import { useSession } from '../../state/session';

export default function LoginScreen() {
  const theme = useTheme();
  const setTokens = useSession((s) => s.setTokens);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [ageOk, setAgeOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    email.includes('@') && password.length >= (mode === 'register' ? 10 : 1) && (mode === 'login' || (name.trim().length >= 2 && ageOk && termsOk));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const tokens =
        mode === 'login'
          ? await api.login(email.trim(), password)
          : await api.register({ email: email.trim(), password, display_name: name.trim(), age_confirmed: ageOk, accept_terms: termsOk });
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
          Personagem pronto em minutos. Dados que dão frio na barriga.
        </Text>
      </View>

      <SegmentedButtons
        value={mode}
        onValueChange={(v) => setMode(v as 'login' | 'register')}
        buttons={[
          { value: 'login', label: 'Entrar' },
          { value: 'register', label: 'Criar conta' },
        ]}
      />

      {mode === 'register' ? (
        <TextInput label="Como te chamam na mesa" value={name} onChangeText={setName} maxLength={40} mode="outlined" />
      ) : null}
      <TextInput
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        mode="outlined"
      />
      <TextInput
        label="Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        mode="outlined"
      />
      {mode === 'register' ? (
        <>
          <HelperText type="info">Mínimo de 10 caracteres.</HelperText>
          <Checkbox.Item
            label="Tenho 13 anos ou mais"
            status={ageOk ? 'checked' : 'unchecked'}
            onPress={() => setAgeOk(!ageOk)}
            position="leading"
          />
          <Checkbox.Item
            label="Li e aceito os Termos de Uso e a Política de Privacidade"
            status={termsOk ? 'checked' : 'unchecked'}
            onPress={() => setTermsOk(!termsOk)}
            position="leading"
          />
          <View style={styles.links}>
            <Button compact onPress={() => void Linking.openURL(TERMS_URL)}>
              Termos de Uso
            </Button>
            <Button compact onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
              Política de Privacidade
            </Button>
          </View>
        </>
      ) : null}

      {error ? <HelperText type="error">{error}</HelperText> : null}
      <Button mode="contained" onPress={submit} disabled={!canSubmit || busy} loading={busy}>
        {mode === 'login' ? 'Entrar' : 'Criar conta'}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 48, marginBottom: 16, gap: 8 },
  links: { flexDirection: 'row', flexWrap: 'wrap' },
});
