/** Escolher servidor: trocar de servidor encerra a sessão (as contas são de cada servidor). */
import { useServer } from '../state/server';
import { useSession } from '../state/session';
import { parseJoinLink, probe, type ServerInfo } from './discovery';

export async function chooseServer(server: ServerInfo): Promise<void> {
  const current = useServer.getState().server;
  if (current && current.serverId !== server.serverId) await useSession.getState().signOut();
  await useServer.getState().choose(server);
}

/** QR code / link rpgplay://join: confere o servidor, escolhe e guarda o PIN para entrar depois do login. */
export async function connectFromJoinLink(link: string): Promise<{ ok: true; server: ServerInfo } | { ok: false; error: string }> {
  const parsed = parseJoinLink(link);
  if (!parsed) return { ok: false, error: 'Este QR code não é de uma mesa do RPG Play.' };
  const server = await probe(parsed.server, 2500);
  if (!server) {
    return { ok: false, error: `O servidor ${parsed.server} não respondeu. O celular está no mesmo Wi-Fi que ele?` };
  }
  await chooseServer(server);
  useServer.getState().setPendingPin(parsed.pin);
  return { ok: true, server };
}
