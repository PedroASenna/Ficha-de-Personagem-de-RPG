import { describe, expect, it } from "vitest";

import { fitView, gridLines, mapToScreen, screenToMap, snapPoint, snapToGrid, tokenRadius, zoomAt } from "./geometry";

describe("grade", () => {
  it("encaixa bonecos de tamanho ímpar no centro da casa", () => {
    expect(snapToGrid(10, 70)).toBe(35);
    expect(snapToGrid(69.9, 70)).toBe(35);
    expect(snapToGrid(71, 70)).toBe(105);
    expect(snapToGrid(250, 70, 3)).toBe(245);
  });

  it("encaixa bonecos grandes (tamanho par) no cruzamento das linhas", () => {
    expect(snapToGrid(100, 70, 2)).toBe(70);
    expect(snapToGrid(106, 70, 2)).toBe(140);
    expect(snapPoint({ x: 100, y: 30 }, 50, 2)).toEqual({ x: 100, y: 50 });
  });

  it("trata tamanho ½ como uma casa", () => {
    expect(snapToGrid(10, 70, 0.5)).toBe(35);
  });

  it("lista as linhas internas da grade", () => {
    expect(gridLines(210, 140, 70)).toEqual({ vertical: [70, 140], horizontal: [70] });
    expect(gridLines(100, 100, 2)).toEqual({ vertical: [], horizontal: [] });
  });

  it("calcula o raio do boneco a partir da grade", () => {
    expect(tokenRadius(1, 100)).toBeCloseTo(46);
    expect(tokenRadius(2, 50)).toBeCloseTo(46);
  });
});

describe("tela ↔ mapa", () => {
  const view = { x: 100, y: 50, scale: 2 };

  it("converte ida e volta", () => {
    const map = screenToMap({ x: 300, y: 250 }, view);
    expect(map).toEqual({ x: 100, y: 100 });
    expect(mapToScreen(map, view)).toEqual({ x: 300, y: 250 });
  });

  it("dá zoom mantendo o ponto sob o cursor", () => {
    const pointer = { x: 400, y: 300 };
    const before = screenToMap(pointer, view);
    const zoomed = zoomAt(view, pointer, 1.5);
    expect(zoomed.scale).toBe(3);
    const after = screenToMap(pointer, zoomed);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("limita o zoom", () => {
    expect(zoomAt({ x: 0, y: 0, scale: 3.9 }, { x: 0, y: 0 }, 2).scale).toBe(4);
    expect(zoomAt({ x: 0, y: 0, scale: 0.11 }, { x: 0, y: 0 }, 0.1).scale).toBe(0.1);
  });

  it("enquadra o mapa centralizado", () => {
    const fit = fitView(2000, 1000, 1048, 1048, 24);
    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.x).toBeCloseTo(24);
    expect(fit.y).toBeCloseTo((1048 - 500) / 2);
  });
});
