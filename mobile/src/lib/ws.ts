/**
 * Conexão da mesa (/ws/rooms/{pin}): autentica na 1ª mensagem, reconecta com backoff exponencial
 * e casa cada roll.result com a promessa do pedido (request_id).
 */
import { useSession } from '../state/session';
import { ensureFreshToken } from './api';
import { wsUrl } from './config';
import type { HpChangedMsg, RollResultMsg, ServerMessage } from './types';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

// Códigos definidos em backend/app/ws/protocol.py
const CLOSE_UNAUTHORIZED = 4401;
const FINAL_CODES = new Set([4403, 4404, 4410]);
const PING_INTERVAL_MS = 25_000;
const ROLL_TIMEOUT_MS = 8_000;

type Pending = { resolve: (msg: RollResultMsg) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(15_000, 500 * 2 ** attempt);
  return Math.round(base * (0.75 + random() * 0.5));
}

export class RoomSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private closedByUser = false;
  private triedRefresh = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<string, Pending>();

  constructor(
    private pin: string,
    private onMessage: (msg: ServerMessage) => void,
    private onStatus: (status: SocketStatus, reason?: string) => void,
  ) {}

  connect() {
    this.closedByUser = false;
    this.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(`${wsUrl()}/ws/rooms/${encodeURIComponent(this.pin)}`);
    this.ws = ws;

    ws.onopen = () => {
      const token = useSession.getState().accessToken;
      ws.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        this.attempt = 0;
        this.triedRefresh = false;
        this.onStatus('open');
        this.startPing();
      }
      if (msg.type === 'roll.result') this.settle(msg.request_id, msg);
      if (msg.type === 'error' && msg.ref) this.fail(msg.ref, new Error(msg.message));
      this.onMessage(msg);
    };
    ws.onclose = (event) => {
      this.stopPing();
      this.ws = null;
      if (this.closedByUser) return this.onStatus('closed');
      if (event.code === CLOSE_UNAUTHORIZED && !this.triedRefresh) {
        this.triedRefresh = true;
        void ensureFreshToken().then((ok) => (ok ? this.connect() : this.onStatus('closed', 'Sessão expirada.')));
        return;
      }
      if (FINAL_CODES.has(event.code)) {
        const reason =
          event.code === 4410 ? 'A sala foi encerrada pelo Mestre.' : event.code === 4403 ? 'Você não está mais nesta mesa.' : 'Sala não encontrada.';
        this.rejectAll(new Error(reason));
        return this.onStatus('closed', reason);
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    this.onStatus('reconnecting');
    const delay = backoffDelay(this.attempt++);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private startPing() {
    this.stopPing();
    // Mantém a conexão viva atrás de proxies/load balancers com timeout de ociosidade.
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private send(payload: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  private settle(id: string, msg: RollResultMsg) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(msg);
  }

  private fail(id: string, err: Error) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.reject(err);
  }

  private rejectAll(err: Error) {
    for (const id of [...this.pending.keys()]) this.fail(id, err);
  }

  requestRoll(notation: string, opts: { characterId?: string; label?: string; secret?: boolean } = {}): Promise<RollResultMsg> {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, new Error('O servidor não respondeu. Tente de novo.')), ROLL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const sent = this.send({
        type: 'roll.request',
        id,
        notation,
        character_id: opts.characterId,
        label: opts.label,
        visibility: opts.secret ? 'master_only' : 'public',
      });
      if (!sent) this.fail(id, new Error('Sem conexão com a mesa.'));
    });
  }

  changeHp(characterId: string, delta: number, kind: HpChangedMsg['kind'], expectedVersion?: number): boolean {
    return this.send({ type: 'hp.change', character_id: characterId, delta, kind, expected_version: expectedVersion });
  }

  close() {
    this.closedByUser = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopPing();
    this.rejectAll(new Error('Conexão encerrada.'));
    this.ws?.close(1000);
  }
}
