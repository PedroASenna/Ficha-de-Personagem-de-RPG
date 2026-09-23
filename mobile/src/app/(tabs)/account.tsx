/** Conta: exportação de dados (LGPD), exclusão de conta (exigência da Play Store), licenças e política. */
import { useState } from 'react';
import { Linking, Share } from 'react-native';
import { Button, Card, Dialog, HelperText, List, Portal, Text, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { api, ApiError } from '../../lib/api';
import { ACCOUNT_DELETION_URL, PRIVACY_POLICY_URL, TERMS_URL } from '../../lib/config';
import { useRulesets } from '../../lib/queries';
import { useSession } from '../../state/session';

export default function AccountScreen() {
  const theme = useTheme();
  const user = useSession((s) => s.user);
  const refreshToken = useSession((s) => s.refreshToken);
  const signOut = useSession((s) => s.signOut);
  const { data: rulesets } = useRulesets();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLicenses, setShowLicenses] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportData = async () => {
    setError(null);
    try {
      const data = await api.exportData();
      await Share.share({ title: 'Meus dados do RPG Play', message: JSON.stringify(data, null, 2) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível exportar.');
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    try {
      await api.deleteAccount();
      await signOut();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível excluir a conta.');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const logout = async () => {
    if (refreshToken) await api.logout(refreshToken).catch(() => undefined);
    await signOut();
  };

  return (
    <Screen>
      <Card mode="contained">
        <Card.Title title={user?.display_name ?? 'Conta'} subtitle={user?.email} />
      </Card>

      <List.Section title="Privacidade">
        <List.Item title="Exportar meus dados" description="Tudo que guardamos sobre você, em JSON" left={(p) => <List.Icon {...p} icon="download" />} onPress={exportData} />
        <List.Item title="Política de Privacidade" left={(p) => <List.Icon {...p} icon="shield-account" />} onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} />
        <List.Item title="Termos de Uso" left={(p) => <List.Icon {...p} icon="file-document" />} onPress={() => void Linking.openURL(TERMS_URL)} />
        <List.Item title="Licenças dos sistemas de regras" left={(p) => <List.Icon {...p} icon="scale-balance" />} onPress={() => setShowLicenses(!showLicenses)} />
      </List.Section>

      {showLicenses
        ? rulesets
            ?.filter((r) => r.attribution)
            .map((r) => (
              <Card key={r.id} mode="outlined">
                <Card.Title title={r.name} subtitle={r.license} />
                <Card.Content>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {r.attribution}
                  </Text>
                </Card.Content>
              </Card>
            ))
        : null}

      {error ? <HelperText type="error">{error}</HelperText> : null}
      <Button mode="outlined" icon="logout" onPress={logout}>
        Sair
      </Button>
      <Button mode="text" textColor={theme.colors.error} icon="account-remove" onPress={() => setConfirmDelete(true)}>
        Excluir minha conta
      </Button>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        Também é possível pedir a exclusão pela web: {ACCOUNT_DELETION_URL}
      </Text>

      <Portal>
        <Dialog visible={confirmDelete} onDismiss={() => setConfirmDelete(false)}>
          <Dialog.Title>Excluir conta?</Dialog.Title>
          <Dialog.Content>
            <Text>
              Seus personagens, retratos e participações em mesas são apagados na hora. Os registros restantes são removidos em até 30 dias. Não dá para desfazer.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button textColor={theme.colors.error} onPress={deleteAccount} loading={busy} disabled={busy}>
              Excluir
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}
