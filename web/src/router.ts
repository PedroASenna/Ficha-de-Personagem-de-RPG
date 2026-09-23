import { create } from "zustand";

export type Route = { name: "rooms" } | { name: "table"; roomId: string };

// O servidor entrega o painel em /mestre (mesmo valor do `base` no vite.config.ts).
const BASE = "/mestre";

export function parseRoute(pathname: string): Route {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const match = /^\/mesa\/([0-9a-f-]{36})\/?$/i.exec(path);
  return match ? { name: "table", roomId: match[1] } : { name: "rooms" };
}

export function routePath(route: Route): string {
  return route.name === "table" ? `${BASE}/mesa/${route.roomId}` : `${BASE}/`;
}

interface RouterState {
  route: Route;
  navigate: (route: Route) => void;
}

/** Roteador mínimo (duas telas) sobre o history do navegador; o servidor devolve o index para /mestre/*. */
export const useRouter = create<RouterState>((set) => ({
  route: parseRoute(window.location.pathname),
  navigate: (route) => {
    window.history.pushState(null, "", routePath(route));
    set({ route });
  },
}));

window.addEventListener("popstate", () => useRouter.setState({ route: parseRoute(window.location.pathname) }));
