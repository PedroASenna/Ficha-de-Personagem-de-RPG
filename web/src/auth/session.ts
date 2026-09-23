import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { Tokens, User } from "../api/types";

interface SessionState {
  access: string | null;
  refresh: string | null;
  user: User | null;
  setTokens: (tokens: Tokens) => void;
  setUser: (user: User | null) => void;
  clear: () => void;
}

/** Sessão do Mestre, guardada no navegador (ou no app do PC) deste computador. */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      access: null,
      refresh: null,
      user: null,
      setTokens: (tokens) => set({ access: tokens.access_token, refresh: tokens.refresh_token }),
      setUser: (user) => set({ user }),
      clear: () => set({ access: null, refresh: null, user: null }),
    }),
    { name: "rpgplay-mestre-sessao", storage: createJSONStorage(() => localStorage) },
  ),
);
