import type { Discovery } from "../api/types";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Endereços que os celulares podem usar para chegar no servidor. Se o painel foi aberto pelo IP da rede
 * (ex.: pelo app do PC), esse é o melhor; se foi aberto no próprio servidor (localhost), usamos os IPs
 * que o servidor informa na descoberta.
 */
export function serverCandidates(location: Pick<Location, "hostname" | "origin">, discovery?: Discovery): string[] {
  const urls: string[] = [];
  if (!LOCAL_HOSTS.has(location.hostname)) urls.push(location.origin);
  for (const address of discovery?.addresses ?? []) urls.push(`http://${address}:${discovery?.port ?? 8080}`);
  return [...new Set(urls)];
}

/** Link lido pelo app dos jogadores (QR code): define o servidor e já entra na mesa com o PIN. */
export function joinLink(server: string, pin: string): string {
  return `rpgplay://join?server=${encodeURIComponent(server)}&pin=${encodeURIComponent(pin)}`;
}
