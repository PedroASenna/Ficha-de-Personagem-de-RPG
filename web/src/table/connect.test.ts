import { describe, expect, it } from "vitest";

import type { Discovery } from "../api/types";
import { joinLink, serverCandidates } from "./connect";

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
});
