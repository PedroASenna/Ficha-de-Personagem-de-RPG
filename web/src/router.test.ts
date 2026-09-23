import { describe, expect, it } from "vitest";

import { parseRoute, routePath } from "./router";

describe("rotas do painel", () => {
  it("reconhece a mesa pelo id", () => {
    const id = "1ca7d695-6903-4fd9-ac4c-da69d52441f6";
    expect(parseRoute(`/mestre/mesa/${id}`)).toEqual({ name: "table", roomId: id });
    expect(routePath({ name: "table", roomId: id })).toBe(`/mestre/mesa/${id}`);
  });

  it("qualquer outra coisa cai na lista de mesas", () => {
    expect(parseRoute("/mestre/")).toEqual({ name: "rooms" });
    expect(parseRoute("/mestre/mesa/nao-e-uuid")).toEqual({ name: "rooms" });
    expect(routePath({ name: "rooms" })).toBe("/mestre/");
  });
});
