// Névoa de guerra: cada personagem tem um mapa de bits por cena (1 = explorado), vindo do servidor em
// base64. O Mestre vê a união de todos, com o inexplorado levemente escurecido.

import type { Scene } from "../api/types";

export function decodeBits(base64: string): Uint8Array {
  const binary = atob(base64);
  const bits = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bits[i] = binary.charCodeAt(i);
  return bits;
}

export function byteLength(scene: Pick<Scene, "fog_cols" | "fog_rows">): number {
  return Math.ceil((scene.fog_cols * scene.fog_rows) / 8);
}

export function isExplored(bits: Uint8Array, index: number): boolean {
  return ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
}

/** Cópia com as células novas marcadas (cópia para o React perceber a mudança). */
export function withCells(bits: Uint8Array | undefined, cells: number[], length: number): Uint8Array {
  const next = new Uint8Array(Math.max(length, bits?.length ?? 0));
  if (bits) next.set(bits);
  for (const index of cells) {
    const byte = index >> 3;
    if (byte < next.length) next[byte] = (next[byte] ?? 0) | (1 << (index & 7));
  }
  return next;
}

/** União da exploração de vários personagens (o que o grupo inteiro já viu). */
export function union(all: Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  for (const bits of all) {
    for (let i = 0; i < length && i < bits.length; i++) result[i] = (result[i] ?? 0) | (bits[i] ?? 0);
  }
  return result;
}

/**
 * Imagem da névoa: um pixel por célula, preto onde não foi explorado. Esticada sobre o mapa com
 * suavização, as bordas ficam macias. `alpha` = opacidade do inexplorado (1 = preto total).
 */
export function fogPixels(bits: Uint8Array, cols: number, rows: number, alpha: number): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(cols * rows * 4);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  for (let index = 0; index < cols * rows; index++) {
    pixels[index * 4 + 3] = isExplored(bits, index) ? 0 : a;
  }
  return pixels;
}
