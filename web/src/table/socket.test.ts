import { describe, expect, it } from "vitest";

import { backoff, socketUrl } from "./socket";

describe("WebSocket da mesa", () => {
  it("usa ws:// ou wss:// conforme a página", () => {
    expect(socketUrl("ABC123", { protocol: "http:", host: "192.168.0.20:8080" })).toBe(
      "ws://192.168.0.20:8080/ws/rooms/ABC123",
    );
    expect(socketUrl("ABC123", { protocol: "https:", host: "mesa.local" })).toBe("wss://mesa.local/ws/rooms/ABC123");
  });

  it("espera cada vez mais para reconectar, até 10 s", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(backoff)).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
  });
});
