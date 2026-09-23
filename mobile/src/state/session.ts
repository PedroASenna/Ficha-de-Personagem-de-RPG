/** Sessão do usuário. Tokens ficam no armazenamento criptografado do sistema (Keystore via expo-secure-store). */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { TokenPair, User } from '../lib/types';

const ACCESS_KEY = 'rpgplay.access';
const REFRESH_KEY = 'rpgplay.refresh';

type SessionState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  restore: () => Promise<void>;
  setTokens: (tokens: TokenPair) => Promise<void>;
  setUser: (user: User | null) => void;
  signOut: () => Promise<void>;
};

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  accessToken: null,
  refreshToken: null,
  user: null,
  restore: async () => {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
    set({ accessToken, refreshToken, status: refreshToken ? 'signedIn' : 'signedOut' });
  },
  setTokens: async ({ access_token, refresh_token }) => {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, access_token),
      SecureStore.setItemAsync(REFRESH_KEY, refresh_token),
    ]);
    set({ accessToken: access_token, refreshToken: refresh_token, status: 'signedIn' });
  },
  setUser: (user) => set({ user }),
  signOut: async () => {
    await Promise.all([SecureStore.deleteItemAsync(ACCESS_KEY), SecureStore.deleteItemAsync(REFRESH_KEY)]);
    set({ accessToken: null, refreshToken: null, user: null, status: 'signedOut' });
  },
}));
