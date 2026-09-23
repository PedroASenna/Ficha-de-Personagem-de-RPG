import { useSession } from "../auth/session";
import type { Tokens } from "./types";

export const API = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Mensagem legível a partir do corpo de erro do FastAPI (texto, código de domínio ou lista de validação). */
export function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string; loc?: unknown[] };
      const field = Array.isArray(first.loc) && first.loc.length > 1 ? first.loc[first.loc.length - 1] : undefined;
      const msg = (first.msg ?? "dados inválidos").replace(/^Value error, /, "");
      return field && typeof field === "string" ? `${field}: ${msg}` : msg;
    }
  }
  if (status === 0) return "Sem conexão com o servidor.";
  if (status >= 500) return "O servidor teve um problema. Tente de novo.";
  return `Erro ${status}.`;
}

let refreshing: Promise<boolean> | null = null;

/** Troca o refresh token por um par novo. Chamadas simultâneas compartilham a mesma troca (o token vale uma vez). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const { refresh, setTokens, clear } = useSession.getState();
    if (!refresh) return false;
    try {
      const response = await fetch(`${API}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!response.ok) {
        if (response.status === 401) clear();
        return false;
      }
      setTokens((await response.json()) as Tokens);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  form?: FormData;
  auth?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const { method = options.json !== undefined || options.form ? "POST" : "GET", json, form, auth = true } = options;
  const headers: Record<string, string> = {};
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const access = useSession.getState().access;
  if (auth && access) headers.Authorization = `Bearer ${access}`;

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
    });
  } catch {
    throw new ApiError(0, errorMessage(0, null));
  }

  if (response.status === 401 && auth && !retried && (await refreshSession())) {
    return api<T>(path, options, true);
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code = body && typeof body === "object" && "code" in body ? String(body.code) : undefined;
    throw new ApiError(response.status, errorMessage(response.status, body), code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
