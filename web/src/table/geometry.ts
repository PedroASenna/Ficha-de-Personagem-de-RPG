// Geometria da mesa virtual: coordenadas do mapa (pixels da imagem) ↔ tela, zoom e grade.

export interface Point {
  x: number;
  y: number;
}

/** Transformação do palco: posição (px da tela) e escala. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function screenToMap(point: Point, view: View): Point {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

export function mapToScreen(point: Point, view: View): Point {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}

/** Zoom mantendo fixo o ponto do mapa que está sob o cursor. */
export function zoomAt(view: View, pointer: Point, factor: number): View {
  const scale = clamp(view.scale * factor, MIN_ZOOM, MAX_ZOOM);
  const anchor = screenToMap(pointer, view);
  return { scale, x: pointer.x - anchor.x * scale, y: pointer.y - anchor.y * scale };
}

/** Enquadra o mapa inteiro no espaço disponível, centralizado. */
export function fitView(mapWidth: number, mapHeight: number, width: number, height: number, padding = 24): View {
  const scale = clamp(
    Math.min((width - padding * 2) / mapWidth, (height - padding * 2) / mapHeight),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  return { scale, x: (width - mapWidth * scale) / 2, y: (height - mapHeight * scale) / 2 };
}

/**
 * Encaixa o centro de um boneco na grade. Bonecos de tamanho ímpar (1, 3...) ficam no centro de uma
 * casa; os de tamanho par (2, 4...) ocupam um bloco e ficam no cruzamento das linhas.
 */
export function snapToGrid(value: number, grid: number, size = 1): number {
  const cells = Math.max(1, Math.round(size));
  if (cells % 2 === 1) return Math.floor(value / grid) * grid + grid / 2;
  return Math.round(value / grid) * grid;
}

export function snapPoint(point: Point, grid: number, size = 1): Point {
  return { x: snapToGrid(point.x, grid, size), y: snapToGrid(point.y, grid, size) };
}

export function clampToMap(point: Point, width: number, height: number): Point {
  return { x: clamp(point.x, 0, width), y: clamp(point.y, 0, height) };
}

/** Raio do boneco em pixels do mapa (uma casa de folga para o anel). */
export function tokenRadius(size: number, grid: number): number {
  return (size * grid * 0.92) / 2;
}

/** Linhas da grade visíveis (evita desenhar milhares de linhas em mapas grandes). */
export function gridLines(width: number, height: number, grid: number): { vertical: number[]; horizontal: number[] } {
  const vertical: number[] = [];
  const horizontal: number[] = [];
  if (grid < 4) return { vertical, horizontal };
  for (let x = grid; x < width; x += grid) vertical.push(x);
  for (let y = grid; y < height; y += grid) horizontal.push(y);
  return { vertical, horizontal };
}
