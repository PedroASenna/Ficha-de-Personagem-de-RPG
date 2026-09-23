// Descoberta do servidor RPG Play na rede de casa.
// 1) Broadcast UDP "RPGPLAY_DISCOVER" na porta 47777: cada servidor responde com um JSON (o IP vem do pacote).
// 2) Se ninguém responder (roteador bloqueando broadcast), varre a sub-rede em GET /api/v1/discovery.

import dgram from "node:dgram";
import os from "node:os";

export const MAGIC = "RPGPLAY_DISCOVER";
export const DEFAULT_DISCOVERY_PORT = 47777;
export const DEFAULT_HTTP_PORT = 8080;

export interface ServerInfo {
  url: string; // origem, ex.: http://192.168.0.20:8080
  name: string;
  version: string;
  serverId: string;
}

type Interfaces = ReturnType<typeof os.networkInterfaces>;
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

interface DiscoveryPayload {
  app?: unknown;
  name?: unknown;
  version?: unknown;
  server_id?: unknown;
  port?: unknown;
}

/** Guarda um servidor; se ele respondeu por dois caminhos, prefere o IP da rede ao 127.0.0.1. */
function remember(found: Map<string, ServerInfo>, info: ServerInfo): void {
  const existing = found.get(info.serverId);
  if (!existing || (existing.url.includes("//127.") && !info.url.includes("//127."))) found.set(info.serverId, info);
}

function toInfo(payload: DiscoveryPayload, origin: string): ServerInfo | null {
  if (payload.app !== "rpgplay" || typeof payload.name !== "string") return null;
  return {
    url: origin,
    name: payload.name,
    version: typeof payload.version === "string" ? payload.version : "?",
    serverId: typeof payload.server_id === "string" ? payload.server_id : origin,
  };
}

/** Resposta UDP → servidor (o endereço é quem respondeu, a porta vem no JSON). */
export function parseReply(data: string, address: string): ServerInfo | null {
  try {
    const payload = JSON.parse(data) as DiscoveryPayload;
    const port = typeof payload.port === "number" ? payload.port : DEFAULT_HTTP_PORT;
    return toInfo(payload, `http://${address}:${port}`);
  } catch {
    return null;
  }
}

/** "192.168.0.20", "192.168.0.20:8080", "http://casa.local:8080/mestre" → origem http://host:porta. */
export function normalizeServerUrl(input: string, defaultPort = DEFAULT_HTTP_PORT): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.port) url.port = String(url.protocol === "https:" ? 443 : defaultPort);
    return url.origin;
  } catch {
    return null;
  }
}

export function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}

export function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function lanInterfaces(interfaces: Interfaces) {
  return Object.values(interfaces)
    .flat()
    .filter((i): i is os.NetworkInterfaceInfoIPv4 => Boolean(i) && i!.family === "IPv4" && !i!.internal);
}

/** Endereços de broadcast de cada rede (ex.: 192.168.0.255) + o broadcast geral e o próprio computador. */
export function broadcastAddresses(interfaces: Interfaces = os.networkInterfaces()): string[] {
  const addresses = lanInterfaces(interfaces).map((i) =>
    intToIpv4((ipv4ToInt(i.address) | ~ipv4ToInt(i.netmask)) >>> 0),
  );
  return [...new Set([...addresses, "255.255.255.255", "127.0.0.1"])];
}

/** IPs a testar na varredura HTTP: a faixa /24 de cada rede do computador (254 endereços cada). */
export function scanCandidates(interfaces: Interfaces = os.networkInterfaces()): string[] {
  const hosts = new Set<string>(["127.0.0.1"]);
  for (const i of lanInterfaces(interfaces)) {
    const base = ipv4ToInt(i.address) & 0xffffff00;
    for (let host = 1; host < 255; host++) hosts.add(intToIpv4((base | host) >>> 0));
  }
  return [...hosts];
}

/** Pergunta a um endereço se ele é um servidor RPG Play. */
export async function probe(origin: string, timeoutMs = 800, fetchImpl: FetchLike = fetch): Promise<ServerInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}/api/v1/discovery`, { signal: controller.signal });
    if (!response.ok) return null;
    return toInfo((await response.json()) as DiscoveryPayload, origin);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function udpDiscover(
  port = DEFAULT_DISCOVERY_PORT,
  timeoutMs = 1500,
  targets: string[] = broadcastAddresses(),
): Promise<ServerInfo[]> {
  const found = new Map<string, ServerInfo>();
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, () => {
      socket.off("error", reject);
      resolve();
    });
  });
  socket.on("error", () => undefined);
  socket.on("message", (message, rinfo) => {
    const info = parseReply(message.toString("utf8"), rinfo.address);
    if (info) remember(found, info);
  });
  socket.setBroadcast(true);
  const packet = Buffer.from(MAGIC);
  for (const target of targets) socket.send(packet, port, target, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  socket.close();
  return [...found.values()];
}

export async function httpScan(
  hosts: string[],
  port = DEFAULT_HTTP_PORT,
  options: { concurrency?: number; timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<ServerInfo[]> {
  const { concurrency = 48, timeoutMs = 700, fetchImpl = fetch } = options;
  const found = new Map<string, ServerInfo>();
  let next = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const host = hosts[next++];
      const info = await probe(`http://${host}:${port}`, timeoutMs, fetchImpl);
      if (info) remember(found, info);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  return [...found.values()];
}

/** UDP primeiro (rápido); se ninguém responder, varredura HTTP. Servidores repetidos aparecem uma vez só. */
export async function discover(
  options: { discoveryPort?: number; httpPort?: number; udpTimeoutMs?: number } = {},
): Promise<ServerInfo[]> {
  const viaUdp = await udpDiscover(options.discoveryPort, options.udpTimeoutMs).catch(() => []);
  if (viaUdp.length > 0) return viaUdp;
  return httpScan(scanCandidates(), options.httpPort);
}
