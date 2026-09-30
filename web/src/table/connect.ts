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

/**
 * Link lido pelo app dos jogadores (QR code): define o servidor e já entra na mesa com o PIN. Pela internet
 * vai junto o código de acesso, que o app preenche sozinho na criação da conta.
 */
export function joinLink(server: string, pin: string, code?: string | null): string {
  const link = `rpgplay://join?server=${encodeURIComponent(server)}&pin=${encodeURIComponent(pin)}`;
  return code ? `${link}&code=${encodeURIComponent(code)}` : link;
}

/** Página de convite do servidor (https, clicável no WhatsApp): o botão dela abre o app já com tudo. */
export function inviteUrl(server: string, pin: string, code: string): string {
  return `${server.replace(/\/$/, "")}/entrar?pin=${encodeURIComponent(pin)}&code=${encodeURIComponent(code)}`;
}

/** Texto pronto para mandar no grupo (WhatsApp, Discord...) para quem joga de longe. */
export function inviteText(server: string, pin: string, code: string): string {
  return [
    "Bora jogar RPG! Abra este link no celular:",
    inviteUrl(server, pin, code),
    "",
    `Se preferir digitar no app RPG Play: endereço ${server} · código de acesso ${code} · PIN ${pin}`,
  ].join("\n");
}
