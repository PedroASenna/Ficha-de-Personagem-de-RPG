/** Entrar numa mesa pelo PIN. Se a mesa pede aprovação, o jogador vai para a sala de espera. */
import { router } from 'expo-router';

import { api, ApiError } from './api';
import type { Room } from './types';

export type JoinOutcome = { kind: 'joined'; room: Room } | { kind: 'waiting' };

export async function joinByPin(pin: string, characterId?: string): Promise<JoinOutcome> {
  try {
    return { kind: 'joined', room: await api.joinRoom(pin, characterId) };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'join_pending') return { kind: 'waiting' };
    throw e;
  }
}

/** Abre a mesa ou a sala de espera, conforme o resultado. */
export function openJoined(outcome: JoinOutcome, pin: string): void {
  if (outcome.kind === 'joined') router.push({ pathname: '/room/[pin]', params: { pin: outcome.room.pin } });
  else router.push({ pathname: '/room/waiting', params: { pin } });
}
