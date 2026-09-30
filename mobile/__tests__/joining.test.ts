import { ApiError } from '../src/lib/api';
import { joinByPin, keepInvite, openJoined } from '../src/lib/joining';
import { useServer } from '../src/state/server';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

const mockJoinRoom = jest.fn();
jest.mock('../src/lib/api', () => {
  const actual = jest.requireActual('../src/lib/api');
  return { ...actual, api: { ...actual.api, joinRoom: (...args: unknown[]) => mockJoinRoom(...args) } };
});

const room = { id: 'r1', pin: 'ABC123', name: 'Mesa' };

describe('entrar pelo PIN', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockJoinRoom.mockReset();
  });

  it('entra direto quando a mesa não pede aprovação', async () => {
    mockJoinRoom.mockResolvedValue(room);
    const outcome = await joinByPin('ABC123');
    expect(outcome).toEqual({ kind: 'joined', room });
    openJoined(outcome, 'ABC123');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/room/[pin]', params: { pin: 'ABC123' } });
  });

  it('vai para a sala de espera quando o Mestre precisa aceitar', async () => {
    mockJoinRoom.mockRejectedValue(new ApiError('Pedido enviado.', 409, 'join_pending'));
    const outcome = await joinByPin('ABC123');
    expect(outcome).toEqual({ kind: 'waiting' });
    openJoined(outcome, 'ABC123');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/room/waiting', params: { pin: 'ABC123' } });
  });

  it('recusado ou PIN errado continuam sendo erro', async () => {
    mockJoinRoom.mockRejectedValue(new ApiError('O Mestre não aceitou.', 403, 'join_denied'));
    await expect(joinByPin('ABC123')).rejects.toThrow('O Mestre não aceitou.');
  });
});

describe('convite depois do login', () => {
  it('guarda o PIN na aba Mesas sem entrar sozinho na mesa', () => {
    mockPush.mockReset();
    mockJoinRoom.mockReset();
    keepInvite('ABC123');
    expect(useServer.getState().invitePin).toBe('ABC123');
    expect(mockPush).toHaveBeenCalledWith('/rooms');
    expect(mockJoinRoom).not.toHaveBeenCalled();
  });
});
