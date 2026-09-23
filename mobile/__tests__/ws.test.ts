import { backoffDelay, RoomSocket } from '../src/lib/ws';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { apiUrl: 'http://api.test' } } } }));


describe('backoffDelay', () => {
  it('cresce exponencialmente com jitter e satura em ~15s', () => {
    const mid = () => 0.5;
    expect(backoffDelay(0, mid)).toBe(500);
    expect(backoffDelay(1, mid)).toBe(1000);
    expect(backoffDelay(3, mid)).toBe(4000);
    expect(backoffDelay(10, mid)).toBe(15000);
    expect(backoffDelay(2, () => 0)).toBe(1500);
    expect(backoffDelay(2, () => 1)).toBe(2500);
  });
});

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

describe('RoomSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  });

  it('autentica na 1ª mensagem e resolve a rolagem pelo request_id', async () => {
    const statuses: string[] = [];
    const socket = new RoomSocket('ABC234', () => undefined, (s) => statuses.push(s));
    socket.connect();
    const ws = FakeWebSocket.instances[0]!;
    expect(ws.url).toBe('ws://api.test/ws/rooms/ABC234');
    ws.open();
    expect(JSON.parse(ws.sent[0]!).type).toBe('auth');
    ws.receive({ type: 'welcome', room: {}, log: [] });
    expect(statuses).toContain('open');

    const pending = socket.requestRoll('1d20+5', { secret: true });
    const request = JSON.parse(ws.sent[1]!);
    expect(request).toMatchObject({ type: 'roll.request', notation: '1d20+5', visibility: 'master_only' });
    ws.receive({ type: 'roll.result', request_id: request.id, roll: { total: 17 }, outcome: { tier: 'high' } });
    await expect(pending).resolves.toMatchObject({ roll: { total: 17 } });
    socket.close();
  });

  it('erro do servidor com ref rejeita a rolagem correspondente', async () => {
    const socket = new RoomSocket('ABC234', () => undefined, () => undefined);
    socket.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.receive({ type: 'welcome', room: {}, log: [] });
    const pending = socket.requestRoll('1d7');
    const request = JSON.parse(ws.sent[1]!);
    ws.receive({ type: 'error', code: 'invalid_notation', message: 'Dado d7 não é suportado.', ref: request.id });
    await expect(pending).rejects.toThrow('Dado d7 não é suportado.');
    socket.close();
  });

  it('sala encerrada pelo Mestre fecha de vez (sem reconectar)', () => {
    jest.useFakeTimers();
    const statuses: [string, string | undefined][] = [];
    const socket = new RoomSocket('ABC234', () => undefined, (s, r) => statuses.push([s, r]));
    socket.connect();
    FakeWebSocket.instances[0]!.onclose?.({ code: 4410 });
    jest.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toEqual(['closed', 'A sala foi encerrada pelo Mestre.']);
    jest.useRealTimers();
  });

  it('queda de rede reconecta com backoff', () => {
    jest.useFakeTimers();
    const socket = new RoomSocket('ABC234', () => undefined, () => undefined);
    socket.connect();
    FakeWebSocket.instances[0]!.onclose?.({ code: 1006 });
    jest.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    socket.close();
    jest.useRealTimers();
  });
});
