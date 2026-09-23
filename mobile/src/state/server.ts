/**
 * Servidor da casa escolhido neste celular (achado na rede, digitado ou lido do QR code do Mestre).
 * Fica guardado para as próximas aberturas do app.
 */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { ServerInfo } from '../lib/discovery';

const SERVER_KEY = 'rpgplay.server';

type ServerState = {
  status: 'loading' | 'ready';
  server: ServerInfo | null;
  /** PIN vindo do QR code: entra na mesa assim que o login terminar. */
  pendingPin: string | null;
  restore: () => Promise<void>;
  choose: (server: ServerInfo) => Promise<void>;
  forget: () => Promise<void>;
  setPendingPin: (pin: string | null) => void;
};

export const useServer = create<ServerState>((set) => ({
  status: 'loading',
  server: null,
  pendingPin: null,
  restore: async () => {
    let server: ServerInfo | null = null;
    try {
      const saved = await SecureStore.getItemAsync(SERVER_KEY);
      server = saved ? (JSON.parse(saved) as ServerInfo) : null;
    } catch {
      server = null;
    }
    set({ server, status: 'ready' });
  },
  choose: async (server) => {
    await SecureStore.setItemAsync(SERVER_KEY, JSON.stringify(server));
    set({ server });
  },
  forget: async () => {
    await SecureStore.deleteItemAsync(SERVER_KEY);
    set({ server: null });
  },
  setPendingPin: (pendingPin) => set({ pendingPin }),
}));

/** URL base do servidor atual (ex.: http://192.168.0.20:8080). */
export function currentServerUrl(): string {
  const server = useServer.getState().server;
  if (!server) throw new Error('Nenhum servidor escolhido.');
  return server.url;
}
