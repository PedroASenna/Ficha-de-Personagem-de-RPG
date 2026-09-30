import { describe, expect, it } from "vitest";

import type { Discovery } from "../api/types";
import { inviteText, joinLink, serverCandidates } from "./connect";

const discovery = { port: 8080, addresses: ["192.168.0.20", "10.0.0.5"] } as Discovery;

describe("conectar celulares", () => {
  it("usa o endereço pelo qual o painel foi aberto quando não é localhost", () => {
    expect(serverCandidates({ hostname: "192.168.0.20", origin: "http://192.168.0.20:8080" }, discovery)).toEqual([
      "http://192.168.0.20:8080",
      "http://10.0.0.5:8080",
    ]);
  });

  it("no próprio servidor (localhost) usa os IPs da rede informados pela descoberta", () => {
    expect(serverCandidates({ hostname: "localhost", origin: "http://localhost:8080" }, discovery)).toEqual([
      "http://192.168.0.20:8080",
      "http://10.0.0.5:8080",
    ]);
    expect(serverCandidates({ hostname: "127.0.0.1", origin: "http://127.0.0.1:8080" })).toEqual([]);
  });

  it("monta o link do QR code", () => {
    expect(joinLink("http://192.168.0.20:8080", "ABC123")).toBe(
      "rpgplay://join?server=http%3A%2F%2F192.168.0.20%3A8080&pin=ABC123",
    );
  });

  it("pela internet, o link leva o código de acesso", () => {
    expect(joinLink("https://mesa-abc.trycloudflare.com", "ABC123", "ABCD-EFGH")).toBe(
      "rpgplay://join?server=https%3A%2F%2Fmesa-abc.trycloudflare.com&pin=ABC123&code=ABCD-EFGH",
    );
    const text = inviteText("https://mesa-abc.trycloudflare.com", "ABC123", "ABCD-EFGH");
    expect(text).toContain("https://mesa-abc.trycloudflare.com/entrar?pin=ABC123&code=ABCD-EFGH");
    expect(text).toContain("ABCD-EFGH");
    expect(text).toContain("PIN ABC123");
  });

  it("sem código exigido, o convite só leva o link e o PIN", () => {
    expect(joinLink("https://mesa-abc.trycloudflare.com", "ABC123", null)).not.toContain("code=");
    const text = inviteText("https://mesa-abc.trycloudflare.com", "ABC123", null);
    expect(text).toContain("https://mesa-abc.trycloudflare.com/entrar?pin=ABC123\n");
    expect(text).not.toContain("código");
  });
});
