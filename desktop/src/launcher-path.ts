// A tela local de escolha do servidor é a única que fala com o processo principal. Para saber se quem chama é
// ela, compara a URL file:// da página com o caminho do launcher.html. No Windows a URL vem como
// file:///C:/Program%20Files/... e o caminho como C:\Program Files\... (e a letra do disco pode mudar de caixa).

import path from "node:path";

/** Caminho local de uma URL file:// no formato do sistema (file:///C:/x/a.html → C:\x\a.html no Windows). */
export function fileUrlPath(url: URL, platform: NodeJS.Platform = process.platform): string {
  const pathname = decodeURIComponent(url.pathname);
  if (platform !== "win32") return path.posix.normalize(pathname);
  const local = /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname;
  const share = url.hostname ? `\\\\${url.hostname}` : "";
  return path.win32.normalize(share + local.replace(/\//g, "\\"));
}

/** A URL (com ou sem ?parâmetros) é a do launcher.html? */
export function isLauncherUrl(url: string, launcher: string, platform: NodeJS.Platform = process.platform): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "file:") return false;
  const page = fileUrlPath(parsed, platform);
  if (platform !== "win32") return page === path.posix.normalize(launcher);
  return page.toLowerCase() === path.win32.normalize(launcher).toLowerCase();
}
