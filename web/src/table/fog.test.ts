import { describe, expect, it } from "vitest";

import { decodeBits, fogPixels, isExplored, union, withCells } from "./fog";

describe("névoa", () => {
  it("decodifica os bits do servidor (bit 0 do byte é a primeira célula)", () => {
    const bits = decodeBits(btoa(String.fromCharCode(0b10000001, 0b00000010)));
    expect([0, 1, 7, 8, 9].map((i) => isExplored(bits, i))).toEqual([true, false, true, false, true]);
  });

  it("marca células sem mexer no original e une a exploração do grupo", () => {
    const before = new Uint8Array(2);
    const after = withCells(before, [3, 12], 2);
    expect(isExplored(before, 3)).toBe(false);
    expect(isExplored(after, 3) && isExplored(after, 12)).toBe(true);
    const all = union([withCells(undefined, [0], 2), withCells(undefined, [15], 2)], 2);
    expect(isExplored(all, 0) && isExplored(all, 15) && !isExplored(all, 7)).toBe(true);
  });

  it("pinta de preto (ou translúcido, para o Mestre) só o inexplorado", () => {
    const pixels = fogPixels(withCells(undefined, [1], 1), 2, 1, 0.4);
    expect(Array.from(pixels)).toEqual([0, 0, 0, 102, 0, 0, 0, 0]);
  });
});
