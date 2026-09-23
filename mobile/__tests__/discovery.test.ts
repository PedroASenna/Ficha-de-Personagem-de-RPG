import { normalizeServerUrl, parseJoinLink, probe, scanSubnet, subnetHosts } from '../src/lib/discovery';

describe('endereço do servidor', () => {
  it('normaliza o que o jogador digita', () => {
    expect(normalizeServerUrl('192.168.0.20')).toBe('http://192.168.0.20:8080');
    expect(normalizeServerUrl(' 192.168.0.20:9000 ')).toBe('http://192.168.0.20:9000');
    expect(normalizeServerUrl('HTTP://Casa.Local:8080/mestre/')).toBe('http://casa.local:8080');
    expect(normalizeServerUrl('https://mesa.exemplo')).toBe('https://mesa.exemplo');
    expect(normalizeServerUrl('http://casa:80')).toBe('http://casa');
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('192.168.0.20:99999')).toBeNull();
    expect(normalizeServerUrl('isso não é endereço')).toBeNull();
  });

  it('lista os 254 vizinhos da rede /24', () => {
    const hosts = subnetHosts('192.168.0.37');
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('192.168.0.1');
    expect(hosts.at(-1)).toBe('192.168.0.254');
    expect(subnetHosts('0.0.0')).toEqual([]);
    expect(subnetHosts('300.1.1.1')).toEqual([]);
  });

  it('lê o QR code do painel do Mestre', () => {
    expect(parseJoinLink('rpgplay://join?server=http%3A%2F%2F192.168.0.20%3A8080&pin=abc123')).toEqual({
      server: 'http://192.168.0.20:8080',
      pin: 'ABC123',
    });
    expect(parseJoinLink('rpgplay://join?server=192.168.0.20')).toEqual({ server: 'http://192.168.0.20:8080', pin: null });
    expect(parseJoinLink('rpgplay://join?server=192.168.0.20&pin=curto')).toEqual({ server: 'http://192.168.0.20:8080', pin: null });
    expect(parseJoinLink('https://exemplo.com/?server=x')).toBeNull();
    expect(parseJoinLink('rpgplay://join?pin=ABC123')).toBeNull();
  });
});

type Answer = Record<string, unknown>;

function fakeFetch(answers: Record<string, Answer>) {
  return async (url: string) => {
    const answer = answers[url];
    if (!answer) throw new Error('recusado');
    return { ok: true, json: async () => answer };
  };
}

describe('varredura da rede', () => {
  const casa = { app: 'rpgplay', name: 'Casa do Pedro', version: '0.2.0', server_id: 'abc', registration_open: false };

  it('reconhece só servidores RPG Play', async () => {
    const fetchImpl = fakeFetch({
      'http://10.0.0.5:8080/api/v1/discovery': casa,
      'http://10.0.0.6:8080/api/v1/discovery': { app: 'outro' },
    });
    await expect(probe('http://10.0.0.5:8080', 500, fetchImpl)).resolves.toEqual({
      url: 'http://10.0.0.5:8080',
      name: 'Casa do Pedro',
      version: '0.2.0',
      serverId: 'abc',
      registrationOpen: false,
    });
    await expect(probe('http://10.0.0.6:8080', 500, fetchImpl)).resolves.toBeNull();
    await expect(probe('http://10.0.0.7:8080', 500, fetchImpl)).resolves.toBeNull();
  });

  it('acha o servidor na rede e avisa o progresso', async () => {
    const found: string[] = [];
    let lastProgress = 0;
    const servers = await scanSubnet('10.0.0.99', {
      fetchImpl: fakeFetch({ 'http://10.0.0.42:8080/api/v1/discovery': casa }),
      onFound: (s) => found.push(s.url),
      onProgress: (done, total) => (lastProgress = done / total),
    });
    expect(servers.map((s) => s.url)).toEqual(['http://10.0.0.42:8080']);
    expect(found).toEqual(['http://10.0.0.42:8080']);
    expect(lastProgress).toBe(1);
  });

  it('para quando a tela é fechada', async () => {
    const signal = { cancelled: false };
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 10) signal.cancelled = true;
      throw new Error('ninguém');
    };
    await scanSubnet('10.0.0.1', { fetchImpl, signal, concurrency: 1 });
    expect(calls).toBe(10);
  });
});
