/** Conta no servidor da casa: senha, servidor, exportação e exclusão dos dados, licenças das regras. */
import { useState } from 'react';
import { Share } from 'react-native';
import { Button, Card, Dialog, HelperText, List, Portal, Text, TextInput, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { api, ApiError } from '../../lib/api';
import { useRulesets } from '../../lib/queries';
import { useServer } from '../../state/server';
import { useSession } from '../../state/session';

export default function AccountScreen() {
  const theme = useTheme();
  const user = useSession((s) => s.user);
  const refreshToken = useSession((s) => s.refreshToken);
  const signOut = useSession((s) => s.signOut);
  const { data: rulesets } = useRulesets();
  const server = useServer((s) => s.server);
  const forgetServer = useServer((s) => s.forget);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
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

  const switchServer = async () => {
    await logout();
    await forgetServer();
  };

  const changePassword = async () => {
    setError(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      setNotice('Senha trocada.');
      setChangingPassword(false);
      setCurrentPassword('');
      setNewPassword('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível trocar a senha.');
    }
  };

  return (
    <Screen>
      <Card mode="contained">
        <Card.Title title={user?.display_name ?? 'Conta'} subtitle={user ? `@${user.username}${user.is_admin ? ' · admin' : ''}` : undefined} />
      </Card>

      <List.Section title="Servidor">
        <List.Item
          title={server?.name ?? 'Servidor'}
          description={server ? `${server.url} · v${server.version}` : undefined}
          left={(p) => <List.Icon {...p} icon="server-network" />}
        />
        <List.Item title="Trocar servidor" description="Sai da conta e procura outro servidor" left={(p) => <List.Icon {...p} icon="swap-horizontal" />} onPress={() => void switchServer()} />
      </List.Section>

      <List.Section title="Conta e dados">
        <List.Item title="Trocar senha" left={(p) => <List.Icon {...p} icon="key" />} onPress={() => setChangingPassword(true)} />
        <List.Item title="Exportar meus dados" description="Tudo que o servidor guarda sobre você, em JSON" left={(p) => <List.Icon {...p} icon="download" />} onPress={exportData} />
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
      {notice ? <HelperText type="info">{notice}</HelperText> : null}
      <Button mode="outlined" icon="logout" onPress={logout}>
        Sair
      </Button>
      <Button mode="text" textColor={theme.colors.error} icon="account-remove" onPress={() => setConfirmDelete(true)}>
        Excluir minha conta
      </Button>

      <Portal>
        <Dialog visible={changingPassword} onDismiss={() => setChangingPassword(false)}>
          <Dialog.Title>Trocar senha</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <TextInput mode="outlined" label="Senha atual" secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} />
            <TextInput mode="outlined" label="Senha nova (mín. 8)" secureTextEntry value={newPassword} onChangeText={setNewPassword} />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setChangingPassword(false)}>Cancelar</Button>
            <Button onPress={() => void changePassword()} disabled={!currentPassword || newPassword.length < 8}>
              Salvar
            </Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={confirmDelete} onDismiss={() => setConfirmDelete(false)}>
          <Dialog.Title>Excluir conta?</Dialog.Title>
          <Dialog.Content>
            <Text>
              Seus personagens, retratos e participações em mesas são apagados na hora deste servidor. Não dá para desfazer.
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
