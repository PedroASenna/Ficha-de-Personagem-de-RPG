import { currentServerUrl, useServer } from '../state/server';

/** Base HTTP do servidor da casa escolhido (ex.: http://192.168.0.20:8080). */
export function apiUrl(): string {
  return currentServerUrl();
}

export function wsUrl(): string {
  return apiUrl().replace(/^http/, 'ws');
}

/** O servidor devolve caminhos relativos (/media/...); a imagem vem do mesmo servidor. */
export function absoluteUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith('/')) return url;
  const base = useServer.getState().server?.url;
  return base ? `${base}${url}` : undefined;
}
