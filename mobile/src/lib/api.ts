/** Cliente HTTP da API com renovação automática do token (refresh rotativo). */
import { useSession } from '../state/session';
import { apiUrl } from './config';
import type {
  AttributeMethod,
  Character,
  RollResponse,
  Room,
  RulesetPack,
  RulesetSummary,
  SessionEvent,
  TokenPair,
  User,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown; form?: FormData; auth?: boolean };

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const { refreshToken, setTokens, signOut } = useSession.getState();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${apiUrl()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      await signOut();
      return false;
    }
    await setTokens((await res.json()) as TokenPair);
    return true;
  } catch {
    return false;
  }
}

/** Garante um único refresh em paralelo (o refresh token é de uso único). */
export function ensureFreshToken(): Promise<boolean> {
  refreshing ??= refreshTokens().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(path: string, { method = 'GET', body, form, auth = true }: Options = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = useSession.getState().accessToken;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/api/v1${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor.', 0, 'offline');
  }

  if (res.status === 401 && auth && !retried && (await ensureFreshToken())) {
    return request<T>(path, { method, body, form, auth }, true);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? 'Confira os campos preenchidos.' : 'Erro inesperado.';
    throw new ApiError(message, res.status, (data as { code?: string }).code);
  }
  return data as T;
}

export const api = {
  register: (body: { username: string; password: string; display_name: string }) =>
    request<TokenPair>('/auth/register', { method: 'POST', body, auth: false }),
  login: (username: string, password: string) =>
    request<TokenPair>('/auth/login', { method: 'POST', body: { username, password }, auth: false }),
  changePassword: (current_password: string, new_password: string) =>
    request<void>('/auth/password', { method: 'POST', body: { current_password, new_password } }),
  logout: (refresh_token: string) => request<void>('/auth/logout', { method: 'POST', body: { refresh_token }, auth: false }),

  me: () => request<User>('/me'),
  exportData: () => request<Record<string, unknown>>('/me/export'),
  deleteAccount: () => request<void>('/me', { method: 'DELETE' }),

  rulesets: () => request<RulesetSummary[]>('/rulesets'),
  ruleset: (id: string) => request<RulesetPack>(`/rulesets/${id}`),

  characters: () => request<Character[]>('/characters'),
  character: (id: string) => request<Character>(`/characters/${id}`),
  createDraft: (ruleset_id: string, name: string) => request<Character>('/characters', { method: 'POST', body: { ruleset_id, name } }),
  quickCreate: (body: { ruleset_id: string; name: string; ancestry_key?: string; class_key?: string; ancestry_name?: string; background_name?: string }) =>
    request<Character>('/characters/quick', { method: 'POST', body }),
  patchCharacter: (id: string, body: Record<string, unknown>) => request<Character>(`/characters/${id}`, { method: 'PATCH', body }),
  generateAttributes: (id: string, method: AttributeMethod, scores?: Record<string, number>) =>
    request<Character>(`/characters/${id}/attributes`, { method: 'POST', body: { method, scores } }),
  finalize: (id: string) => request<Character>(`/characters/${id}/finalize`, { method: 'POST' }),
  deleteCharacter: (id: string) => request<void>(`/characters/${id}`, { method: 'DELETE' }),
  changeHp: (id: string, delta: number, kind: 'damage' | 'heal' | 'temp', expected_version?: number) =>
    request<{ hp_current: number; hp_max: number; hp_temp: number; version: number }>(`/characters/${id}/hp`, {
      method: 'POST',
      body: { delta, kind, expected_version },
    }),
  levelUp: (id: string, body: { attributes: Record<string, number>; hp_gain: number | null; expected_version?: number }) =>
    request<Character>(`/characters/${id}/level-up`, { method: 'POST', body }),
  rest: (id: string, type: 'short' | 'long') => request<Character>(`/characters/${id}/rest`, { method: 'POST', body: { type } }),
  useSpellSlot: (id: string, level: string) => request<Character>(`/characters/${id}/spell-slots/${level}/use`, { method: 'POST' }),
  addItem: (id: string, body: { name: string; quantity: number; weight_each: string }) =>
    request<Character>(`/characters/${id}/items`, { method: 'POST', body }),
  removeItem: (id: string, itemId: string) => request<Character>(`/characters/${id}/items/${itemId}`, { method: 'DELETE' }),
  addAbility: (id: string, body: { name: string; level: number; uses_max: number; recharge: string }) =>
    request<Character>(`/characters/${id}/abilities`, { method: 'POST', body }),
  useAbility: (id: string, abilityId: string) => request<Character>(`/characters/${id}/abilities/${abilityId}/use`, { method: 'POST' }),

  roll: (notation: string, ruleset_id?: string) => request<RollResponse>('/dice/roll', { method: 'POST', body: { notation, ruleset_id } }),

  rooms: () => request<Room[]>('/rooms'),
  createRoom: (name: string, ruleset_id: string, max_players = 8) =>
    request<Room>('/rooms', { method: 'POST', body: { name, ruleset_id, max_players } }),
  joinRoom: (pin: string, character_id?: string) => request<Room>('/rooms/join', { method: 'POST', body: { pin, character_id } }),
  roomEvents: (roomId: string) => request<SessionEvent[]>(`/rooms/${roomId}/events`),
  setRoomCharacter: (roomId: string, character_id: string) =>
    request<Room>(`/rooms/${roomId}/character`, { method: 'PUT', body: { character_id } }),
  kick: (roomId: string, user_id: string) => request<void>(`/rooms/${roomId}/kick`, { method: 'POST', body: { user_id } }),
  closeRoom: (roomId: string) => request<void>(`/rooms/${roomId}/close`, { method: 'POST' }),

  report: (target_type: 'user' | 'character' | 'room' | 'event', target_id: string, reason: string, details = '') =>
    request<{ id: string }>('/reports', { method: 'POST', body: { target_type, target_id, reason, details } }),
  block: (user_id: string) => request<void>('/blocks', { method: 'POST', body: { user_id } }),

  /** `rotation`: graus no sentido horário; o servidor gira a foto antes de gravar. */
  uploadPortrait: (uri: string, rotation = 0) => {
    const form = new FormData();
    // React Native aceita { uri, name, type } como arquivo no FormData.
    form.append('file', { uri, name: 'retrato.jpg', type: 'image/jpeg' } as unknown as Blob);
    return request<{ portrait_key: string; url: string }>(`/uploads/portrait?rotation=${Math.round(rotation)}`, { method: 'POST', form });
  },
};
