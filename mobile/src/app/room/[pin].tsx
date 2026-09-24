/**
 * Mesa sincronizada. Jogadores rolam e aplicam dano/cura; o Mestre recebe cada evento em tempo
 * real (notificação + log da sessão) e pode alterar o PV de qualquer personagem da mesa.
 * A aba "Mapa" mostra a cena onde está o boneco do jogador (só o Mestre move os bonecos, no PC).
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Chip,
  Dialog,
  Divider,
  IconButton,
  Menu,
  Portal,
  SegmentedButtons,
  Snackbar,
  Switch,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { DicePicker } from '../../components/dice/DicePicker';
import { DiceTray } from '../../components/dice/DiceTray';
import { HPBar } from '../../components/hud/HPBar';
import { SceneView } from '../../components/table/SceneView';
import { WorldView } from '../../components/table/WorldView';
import { api, ApiError } from '../../lib/api';
import { absoluteUrl } from '../../lib/config';
import { PALETTES } from '../../lib/dice/effects';
import { playHaptic, playHpFeedback } from '../../lib/feedback';
import { useCharacters } from '../../lib/queries';
import { emptyTable, orderedImages, orderedObjects, orderedTokens, tableReducer, type TableState } from '../../lib/table';
import type { Room, RoomMember, ServerMessage, SessionEvent, TableToken } from '../../lib/types';
import { RoomSocket, SocketStatus } from '../../lib/ws';
import { useSession } from '../../state/session';

type LogEntry = { id: string; text: string; color?: string; secret?: boolean };

const CONDITION_COLOR = { ileso: '#62C370', ferido: '#E3A13B', muito_ferido: '#E0584A', caido: '#8A8078' } as const;

function toLogEntry(event: SessionEvent): LogEntry {
  const tier = event.payload.outcome?.tier;
  const palette = tier ? PALETTES[event.payload.outcome!.effect.palette] : undefined;
  return {
    id: String(event.id),
    text: event.payload.summary ?? event.type,
    color: palette?.glow,
    secret: event.visibility === 'master_only',
  };
}

export default function RoomScreen() {
  const { pin } = useLocalSearchParams<{ pin: string }>();
  const theme = useTheme();
  const me = useSession((s) => s.user);
  const { data: myCharacters, refetch: refetchCharacters } = useCharacters();

  const [room, setRoom] = useState<Room | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notation, setNotation] = useState('1d20');
  const [secret, setSecret] = useState(false);
  const [hpTarget, setHpTarget] = useState<RoomMember | null>(null);
  const [hpAmount, setHpAmount] = useState('');
  const [hpKind, setHpKind] = useState<'damage' | 'heal' | 'temp'>('damage');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'map' | 'world'>('table');
  const [table, setTable] = useState<TableState>(emptyTable);
  const [selectedToken, setSelectedToken] = useState<TableToken | null>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const sceneIdRef = useRef<string | null>(null);

  const myUserId = me?.id;
  const iAmMaster = room?.my_role === 'master';
  const myMember = room?.members.find((m) => m.user_id === myUserId) ?? room?.members.find((m) => m.role === room.my_role);
  const myCharacterIdRef = useRef<string | null>(null);
  useEffect(() => {
    myCharacterIdRef.current = myMember?.character?.id ?? null;
  }, [myMember?.character?.id]);

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      setTable((t) => tableReducer(t, msg));
      if (msg.type === 'welcome' || msg.type === 'view.reset') {
        // view.reset também chega quando o Mestre liga a névoa ou esconde quem está numa carroça:
        // só avisa quando a cena realmente mudou.
        const next = msg.table.role === 'player' ? (msg.table.scene?.id ?? null) : null;
        if (msg.type === 'view.reset' && next !== sceneIdRef.current && next) setNotice('O Mestre levou você para outra cena.');
        sceneIdRef.current = next;
      }
      switch (msg.type) {
        case 'welcome':
          setRoom(msg.room);
          setLog(msg.log.map(toLogEntry).reverse());
          break;
        case 'presence':
          setRoom((r) => r && { ...r, members: r.members.map((m) => (m.user_id === msg.user_id ? { ...m, online: msg.online } : m)) });
          break;
        case 'roll.result': {
          const palette = PALETTES[msg.outcome.effect.palette];
          setLog((l) => [{ id: String(msg.event_id), text: msg.summary, color: palette.glow, secret: msg.visibility === 'master_only' }, ...l].slice(0, 200));
          if (msg.actor.user_id !== myUserId) {
            setNotice(msg.summary);
            if (msg.outcome.tier === 'critical_success' || msg.outcome.tier === 'critical_failure') playHaptic(msg.outcome.effect.haptic);
          }
          break;
        }
        case 'hp.changed':
          setLog((l) => [{ id: String(msg.event_id), text: msg.summary, color: msg.effect === 'bleed' ? '#F85149' : '#3FB950' }, ...l].slice(0, 200));
          setRoom(
            (r) =>
              r && {
                ...r,
                members: r.members.map((m) =>
                  m.character?.id === msg.character_id
                    ? { ...m, character: { ...m.character, hp_current: msg.hp_current, hp_max: msg.hp_max, hp_temp: msg.hp_temp, version: msg.version } }
                    : m,
                ),
              },
          );
          if (msg.actor.user_id !== myUserId) setNotice(msg.summary);
          break;
        case 'character.leveled':
          setLog((l) => [{ id: String(msg.event_id), text: msg.summary, color: '#F2C14E' }, ...l].slice(0, 200));
          setNotice(msg.summary);
          playHaptic('success_heavy');
          if (msg.character.id === myCharacterIdRef.current) void refetchCharacters();
          break;
        case 'world.updated':
          setNotice('O Mestre atualizou o mapa do mundo.');
          break;
        case 'member.kicked':
          setRoom((r) => r && { ...r, members: r.members.filter((m) => m.user_id !== msg.user_id) });
          break;
        case 'error':
          setNotice(msg.message);
          break;
      }
    },
    [myUserId, refetchCharacters],
  );

  useEffect(() => {
    if (!pin) return;
    const socket = new RoomSocket(pin, handleMessage, (s, reason) => {
      setStatus(s);
      if (reason) setClosedReason(reason);
    });
    socketRef.current = socket;
    socket.connect();
    return () => socket.close();
  }, [pin, handleMessage]);

  const roll = useCallback(
    async (n: string) => {
      const socket = socketRef.current;
      if (!socket) throw new Error('Sem conexão com a mesa.');
      const msg = await socket.requestRoll(n, { characterId: myMember?.character?.id, secret });
      return { roll: msg.roll, outcome: msg.outcome };
    },
    [myMember?.character?.id, secret],
  );

  const eligible = useMemo(
    () => (myCharacters ?? []).filter((c) => c.status === 'complete' && c.ruleset_id === room?.ruleset_id),
    [myCharacters, room?.ruleset_id],
  );

  const chooseCharacter = async (characterId: string) => {
    if (!room) return;
    try {
      const updated = await api.setRoomCharacter(room.id, characterId);
      setRoom((r) => (r ? { ...updated, members: updated.members.map((m) => ({ ...m, online: r.members.find((x) => x.user_id === m.user_id)?.online ?? m.online })) } : updated));
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Não foi possível escolher o personagem.');
    }
  };

  const applyHp = () => {
    const character = hpTarget?.character;
    const amount = Number(hpAmount);
    if (!character || !amount) return;
    socketRef.current?.changeHp(character.id, amount, hpKind, character.version);
    setHpTarget(null);
    setHpAmount('');
  };

  const memberAction = async (member: RoomMember, action: 'report' | 'block' | 'kick') => {
    setMenuFor(null);
    if (!room) return;
    try {
      if (action === 'report') await api.report('user', member.user_id, 'harassment');
      if (action === 'block') await api.block(member.user_id);
      if (action === 'kick') await api.kick(room.id, member.user_id);
      setNotice(action === 'report' ? 'Denúncia enviada à moderação.' : action === 'block' ? 'Usuário bloqueado.' : 'Jogador removido.');
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Falhou. Tente de novo.');
    }
  };

  const viewSwitch = (
    <SegmentedButtons
      value={view}
      onValueChange={(v) => setView(v as 'table' | 'map' | 'world')}
      buttons={[
        { value: 'table', label: 'Mesa', icon: 'dice-d20' },
        { value: 'map', label: 'Mapa', icon: 'map' },
        { value: 'world', label: 'Mundo', icon: 'earth' },
      ]}
    />
  );

  const tokens = orderedTokens(table);
  const selectedMember = selectedToken?.character_id ? table.party.find((p) => p.id === selectedToken.character_id) : undefined;
  const selectedNpc = selectedToken?.npc_id ? table.npcs[selectedToken.npc_id] : undefined;

  if (view === 'map') {
    return (
      <>
        <Stack.Screen options={{ title: room ? room.name : `Mesa ${pin}` }} />
        <SafeAreaView edges={['bottom']} style={[styles.mapRoot, { backgroundColor: theme.colors.background }]}>
          <View style={styles.mapHeader}>
            {viewSwitch}
            {table.scene ? (
              <Text variant="titleMedium" style={{ textAlign: 'center' }}>
                {table.scene.name}
              </Text>
            ) : null}
          </View>
          {table.scene ? (
            <SceneView
              scene={table.scene}
              tokens={tokens}
              images={orderedImages(table)}
              objects={orderedObjects(table)}
              fog={table.fog}
              npcs={table.npcs}
              party={table.party}
              myCharacterId={myMember?.character?.id}
              selectedId={selectedToken?.id}
              onSelect={setSelectedToken}
            />
          ) : (
            <View style={styles.mapEmpty}>
              <Text variant="titleMedium">Você ainda não está no mapa</Text>
              <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                {table.role === 'master'
                  ? 'Crie as cenas e posicione os bonecos pelo programa RPG Play Mestre no PC.'
                  : 'Quando o Mestre colocar seu personagem numa cena, o mapa aparece aqui.'}
              </Text>
            </View>
          )}
          {selectedToken && (selectedMember || selectedNpc) ? (
            <Card mode="elevated" style={styles.tokenCard} onPress={() => setSelectedToken(null)}>
              <Card.Title
                title={selectedMember?.name ?? selectedNpc?.name}
                subtitle={
                  selectedMember
                    ? [selectedMember.class_name, `Nv ${selectedMember.level}`].filter(Boolean).join(' · ')
                    : 'Inimigo'
                }
                left={(props) =>
                  (selectedMember?.portrait_url ?? selectedNpc?.portrait_url) ? (
                    <Avatar.Image {...props} source={{ uri: absoluteUrl(selectedMember?.portrait_url ?? selectedNpc?.portrait_url) }} />
                  ) : (
                    <Avatar.Text {...props} label={(selectedMember?.name ?? selectedNpc?.name ?? '?').slice(0, 1).toUpperCase()} />
                  )
                }
                right={() =>
                  selectedNpc ? (
                    <Chip style={{ marginRight: 12, backgroundColor: CONDITION_COLOR[selectedNpc.condition] }} textStyle={{ color: '#14100D' }}>
                      {selectedNpc.condition_label}
                    </Chip>
                  ) : null
                }
              />
              {selectedMember ? (
                <Card.Content>
                  <HPBar current={selectedMember.hp_current} max={selectedMember.hp_max} temp={selectedMember.hp_temp} height={16} />
                </Card.Content>
              ) : null}
            </Card>
          ) : null}
        </SafeAreaView>
        <Snackbar visible={!!notice} onDismiss={() => setNotice(null)} duration={3500}>
          {notice ?? ''}
        </Snackbar>
      </>
    );
  }

  if (view === 'world') {
    return (
      <>
        <Stack.Screen options={{ title: room ? room.name : `Mesa ${pin}` }} />
        <Screen>
          {viewSwitch}
          <WorldView world={table.world} />
        </Screen>
        <Snackbar visible={!!notice} onDismiss={() => setNotice(null)} duration={3500}>
          {notice ?? ''}
        </Snackbar>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: room ? room.name : `Mesa ${pin}` }} />
      <Screen>
        {viewSwitch}
        <Banner visible={status === 'reconnecting' || !!closedReason} icon={closedReason ? 'door-closed' : 'wifi-off'} actions={closedReason ? [{ label: 'Sair', onPress: () => router.back() }] : []}>
          {closedReason ?? 'Reconectando à mesa…'}
        </Banner>

        {room ? (
          <View style={styles.header}>
            <Chip icon="key">{`PIN ${room.pin}`}</Chip>
            <Chip icon="book-open-variant">{room.ruleset_name}</Chip>
            {iAmMaster ? <Chip icon="crown">Mestre</Chip> : null}
          </View>
        ) : null}

        {room && !iAmMaster && !myMember?.character ? (
          <Card mode="contained">
            <Card.Title title="Escolha seu personagem" subtitle={`Precisa ser do sistema ${room.ruleset_name}`} />
            <Card.Content style={{ gap: 6 }}>
              {eligible.length === 0 ? <Text>Nenhum personagem compatível.</Text> : null}
              {eligible.map((c) => (
                <Button key={c.id} mode="outlined" onPress={() => chooseCharacter(c.id)}>
                  {c.name} · {c.class_name}
                </Button>
              ))}
            </Card.Content>
            <Card.Actions>
              <Button onPress={() => router.push({ pathname: '/character/new', params: { rulesetId: room.ruleset_id } })}>Criar um agora</Button>
              <Button onPress={() => void refetchCharacters()}>Atualizar</Button>
            </Card.Actions>
          </Card>
        ) : null}

        <Text variant="titleMedium">Grupo</Text>
        {room?.members
          .filter((m) => m.role === 'player' || m.character)
          .map((m) => (
            <Card key={m.user_id} mode="outlined">
              <Card.Title
                title={m.character ? `${m.character.name}` : m.display_name}
                subtitle={`${m.display_name}${m.character?.class_name ? ` · ${m.character.class_name}` : ''}${m.online ? ' · online' : ''}`}
                left={(props) =>
                  m.character?.portrait_url ? (
                    <Avatar.Image {...props} source={{ uri: absoluteUrl(m.character.portrait_url) }} />
                  ) : (
                    <Avatar.Text {...props} label={(m.character?.name ?? m.display_name).slice(0, 1).toUpperCase()} />
                  )
                }
                right={(props) =>
                  m.user_id !== myUserId ? (
                    <Menu
                      visible={menuFor === m.user_id}
                      onDismiss={() => setMenuFor(null)}
                      anchor={<IconButton {...props} icon="dots-vertical" onPress={() => setMenuFor(m.user_id)} accessibilityLabel="Opções do jogador" />}
                    >
                      <Menu.Item leadingIcon="flag" title="Denunciar" onPress={() => memberAction(m, 'report')} />
                      <Menu.Item leadingIcon="account-cancel" title="Bloquear" onPress={() => memberAction(m, 'block')} />
                      {iAmMaster ? <Menu.Item leadingIcon="exit-run" title="Remover da mesa" onPress={() => memberAction(m, 'kick')} /> : null}
                    </Menu>
                  ) : null
                }
              />
              {m.character ? (
                <Card.Content style={{ gap: 8 }}>
                  <HPBar
                    current={m.character.hp_current}
                    max={m.character.hp_max}
                    temp={m.character.hp_temp}
                    height={18}
                    onTransition={m.user_id === myUserId ? playHpFeedback : undefined}
                  />
                  {iAmMaster || m.user_id === myUserId ? (
                    <View style={styles.hpButtons}>
                      <Button compact icon="sword" onPress={() => (setHpKind('damage'), setHpTarget(m))}>
                        Dano
                      </Button>
                      <Button compact icon="heart-plus" onPress={() => (setHpKind('heal'), setHpTarget(m))}>
                        Cura
                      </Button>
                      <Button compact icon="shield" onPress={() => (setHpKind('temp'), setHpTarget(m))}>
                        Temp.
                      </Button>
                    </View>
                  ) : null}
                </Card.Content>
              ) : null}
            </Card>
          ))}

        <Divider />
        <Text variant="titleMedium">Rolar para a mesa</Text>
        <DicePicker onChange={setNotation} />
        <View style={styles.secretRow}>
          <Text>{iAmMaster ? 'Rolagem escondida dos jogadores' : 'Só o Mestre vê o resultado'}</Text>
          <Switch value={secret} onValueChange={setSecret} />
        </View>
        <DiceTray notation={notation} roll={roll} disabled={status !== 'open'} height={260} />

        <Divider />
        <Text variant="titleMedium">{iAmMaster ? 'Log da sessão (tudo)' : 'Log da mesa'}</Text>
        <FlatList
          scrollEnabled={false}
          data={log}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Text style={[styles.logLine, { color: item.color ?? theme.colors.onSurface }]}>
              {item.secret ? '🔒 ' : ''}
              {item.text}
            </Text>
          )}
          ListEmptyComponent={<Text style={{ color: theme.colors.onSurfaceVariant }}>Nada aconteceu ainda.</Text>}
        />
        {iAmMaster && room ? (
          <Button mode="outlined" textColor={theme.colors.error} onPress={() => void api.closeRoom(room.id)}>
            Encerrar mesa
          </Button>
        ) : null}
      </Screen>

      <Portal>
        <Dialog visible={!!hpTarget} onDismiss={() => setHpTarget(null)}>
          <Dialog.Title>{hpTarget?.character?.name}</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <SegmentedButtons
              value={hpKind}
              onValueChange={(v) => setHpKind(v as typeof hpKind)}
              buttons={[
                { value: 'damage', label: 'Dano', icon: 'sword' },
                { value: 'heal', label: 'Cura', icon: 'heart-plus' },
                { value: 'temp', label: 'Temp.', icon: 'shield' },
              ]}
            />
            <TextInput
              mode="outlined"
              label="Quantidade"
              value={hpAmount}
              onChangeText={(t) => setHpAmount(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              autoFocus
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setHpTarget(null)}>Cancelar</Button>
            <Button onPress={applyHp} disabled={!Number(hpAmount)}>
              Aplicar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Snackbar visible={!!notice} onDismiss={() => setNotice(null)} duration={3500}>
        {notice ?? ''}
      </Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  mapRoot: { flex: 1 },
  mapHeader: { padding: 12, gap: 8 },
  mapEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  tokenCard: { position: 'absolute', left: 12, right: 12, bottom: 16 },
  header: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hpButtons: { flexDirection: 'row', justifyContent: 'flex-end' },
  secretRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logLine: { paddingVertical: 4 },
});
