/**
 * Descoberta do servidor RPG Play no Wi-Fi de casa.
 *
 * O celular descobre o próprio IP (expo-network) e pergunta a cada vizinho da faixa /24
 * (192.168.0.1…254) se ele é um servidor RPG Play: GET http://IP:8080/api/v1/discovery.
 * Também dá para digitar o endereço ou ler o QR code do painel do Mestre (rpgplay://join?...).
 */

export const DEFAULT_PORT = 8080;

export type ServerInfo = {
  url: string; // origem, ex.: http://192.168.0.20:8080
  name: string;
  version: string;
  serverId: string;
  registrationOpen: boolean;
};

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

type DiscoveryPayload = {
  app?: unknown;
  name?: unknown;
  version?: unknown;
  server_id?: unknown;
  registration_open?: unknown;
};

/** "192.168.0.20", "192.168.0.20:9000", "http://casa.local:8080/mestre" → http://host:porta */
export function normalizeServerUrl(input: string, defaultPort = DEFAULT_PORT): string | null {
  const text = input.trim();
  if (!text) return null;
  const match = /^(https?):\/\/([^/?#\s]+)(?:[/?#]\S*)?$/i.exec(text) ?? /^()([^/?#\s]+)\/?$/.exec(text);
  if (!match) return null;
  const scheme = (match[1] || 'http').toLowerCase();
  const hostMatch = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(match[2] ?? '');
  if (!hostMatch?.[1]) return null;
  const port = hostMatch[2] ? Number(hostMatch[2]) : scheme === 'https' ? 443 : defaultPort;
  if (port < 1 || port > 65535) return null;
  const host = hostMatch[1].toLowerCase();
  const isDefault = (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443);
  return `${scheme}://${host}${isDefault ? '' : `:${port}`}`;
}

/** Os 254 endereços da mesma rede /24 do celular. */
export function subnetHosts(ip: string): string[] {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return [];
  const prefix = parts.slice(0, 3).join('.');
  const hosts = [];
  for (let host = 1; host < 255; host++) hosts.push(`${prefix}.${host}`);
  return hosts;
}

export function toServerInfo(payload: DiscoveryPayload, origin: string): ServerInfo | null {
  if (payload.app !== 'rpgplay' || typeof payload.name !== 'string') return null;
  return {
    url: origin,
    name: payload.name,
    version: typeof payload.version === 'string' ? payload.version : '?',
    serverId: typeof payload.server_id === 'string' ? payload.server_id : origin,
    registrationOpen: payload.registration_open !== false,
  };
}

export async function probe(origin: string, timeoutMs = 800, fetchImpl: FetchLike = fetch): Promise<ServerInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${origin}/api/v1/discovery`, { signal: controller.signal });
    if (!res.ok) return null;
    return toServerInfo((await res.json()) as DiscoveryPayload, origin);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ScanOptions = {
  port?: number;
  concurrency?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  onFound?: (server: ServerInfo) => void;
  onProgress?: (done: number, total: number) => void;
  signal?: { cancelled: boolean };
};

/** Varre a rede /24 do IP informado. Chama onFound assim que cada servidor responde. */
export async function scanSubnet(ip: string, options: ScanOptions = {}): Promise<ServerInfo[]> {
  const { port = DEFAULT_PORT, concurrency = 32, timeoutMs = 700, fetchImpl = fetch, onFound, onProgress, signal } = options;
  const hosts = subnetHosts(ip);
  const found = new Map<string, ServerInfo>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < hosts.length && !signal?.cancelled) {
      const host = hosts[next++] as string;
      const info = await probe(`http://${host}:${port}`, timeoutMs, fetchImpl);
      done += 1;
      onProgress?.(done, hosts.length);
      if (info && !found.has(info.serverId)) {
        found.set(info.serverId, info);
        onFound?.(info);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  return [...found.values()];
}

/**
 * O servidor não respondeu: o que testar, na ordem. Na prática quase sempre é o firewall do computador do
 * servidor (ufw no Debian/Ubuntu), que o comando `rpgplay-server diagnostico` aponta e resolve.
 */
export function unreachableHelp(server: string): string {
  return (
    `O servidor ${server} não respondeu. Teste abrindo ${server}/api/v1/discovery no navegador do celular. ` +
    'Se não abrir: confira se o celular está no mesmo Wi-Fi (sem VPN) e, no computador do servidor, rode ' +
    '"sudo rpgplay-server diagnostico" (quase sempre é o firewall).'
  );
}

/** Link do QR code do painel do Mestre: rpgplay://join?server=http%3A%2F%2F192.168.0.20%3A8080&pin=ABC123 */
export function parseJoinLink(link: string): { server: string; pin: string | null } | null {
  const match = /^rpgplay:\/\/join\/?\?(.*)$/i.exec(link.trim());
  if (!match) return null;
  const params: Record<string, string> = {};
  for (const pair of (match[1] ?? '').split('&')) {
    const [key = '', value = ''] = pair.split('=');
    try {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }
  const server = params.server ? normalizeServerUrl(params.server) : null;
  if (!server) return null;
  const pin = params.pin && /^[A-Z0-9]{6}$/i.test(params.pin) ? params.pin.toUpperCase() : null;
  return { server, pin };
}
