import { describe, expect, it } from "vitest";

import { abilityModifier, checkNotation, formatModifier, hpColor, hpRatio } from "./rules";

describe("regras", () => {
  it("calcula modificadores estilo d20", () => {
    expect([1, 8, 9, 10, 11, 12, 15, 20].map(abilityModifier)).toEqual([-5, -1, -1, 0, 0, 1, 2, 5]);
    expect(formatModifier(3)).toBe("+3");
    expect(formatModifier(0)).toBe("+0");
    expect(formatModifier(-2)).toBe("-2");
  });

  it("monta a notação do teste de atributo", () => {
    expect(checkNotation(16)).toBe("1d20+3");
    expect(checkNotation(10)).toBe("1d20");
    expect(checkNotation(7)).toBe("1d20-2");
    expect(checkNotation(14, "2d6")).toBe("2d6+2");
  });

  it("colore a barra de PV pela proporção", () => {
    expect(hpRatio(5, 10)).toBe(0.5);
    expect(hpRatio(15, 10)).toBe(1);
    expect(hpRatio(1, 0)).toBe(0);
    expect(hpColor(0.8)).toBe("#62c370");
    expect(hpColor(0.4)).toBe("#e3a13b");
    expect(hpColor(0.1)).toBe("#e0584a");
    expect(hpColor(0)).toBe("#6b6159");
  });
});
