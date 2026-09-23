import { afterEach, describe, expect, it, vi } from "vitest";

import { useSession } from "../auth/session";
import { api, ApiError, errorMessage } from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  useSession.getState().clear();
});

describe("errorMessage", () => {
  it("lê as mensagens do FastAPI", () => {
    expect(errorMessage(409, { detail: "Esse nome de usuário já existe." })).toBe("Esse nome de usuário já existe.");
    expect(
      errorMessage(422, { detail: [{ loc: ["body", "password"], msg: "String should have at least 8 characters" }] }),
    ).toBe("password: String should have at least 8 characters");
    expect(
      errorMessage(422, { detail: [{ loc: ["body"], msg: "Value error, Informe character_id OU npc_id." }] }),
    ).toBe("Informe character_id OU npc_id.");
    expect(errorMessage(0, null)).toBe("Sem conexão com o servidor.");
    expect(errorMessage(502, null)).toMatch(/servidor/);
  });
});

describe("api", () => {
  it("renova o token uma vez quando recebe 401 e repete a chamada", async () => {
    useSession.setState({ access: "velho", refresh: "r1" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { detail: "expirado" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "novo", refresh_token: "r2", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/me")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/auth/refresh");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer novo");
    expect(useSession.getState().refresh).toBe("r2");
  });

  it("encerra a sessão quando o refresh também falha", async () => {
    useSession.setState({ access: "velho", refresh: "r1" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(401, { detail: "expirado" }))
        .mockResolvedValueOnce(jsonResponse(401, { detail: "Sessão expirada. Entre novamente." })),
    );
    await expect(api("/me")).rejects.toBeInstanceOf(ApiError);
    expect(useSession.getState().access).toBeNull();
  });

  it("envia arquivos como multipart e devolve undefined no 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("file", new Blob(["x"]), "mapa.png");
    await expect(api("/rooms/1/images?kind=map", { form })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: form });
    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBeUndefined();
  });
});
