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

/** Retângulo posicionado pelo centro e girado (graus, sentido horário): peças e objetos. */
export interface RotatedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** O ponto cai dentro do retângulo girado? (desfaz a rotação e compara com as metades) */
export function pointInRotatedRect(point: Point, rect: RotatedRect): boolean {
  const angle = (-rect.rotation * Math.PI) / 180;
  const dx = point.x - rect.x;
  const dy = point.y - rect.y;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(localX) <= rect.width / 2 && Math.abs(localY) <= rect.height / 2;
}

/** Objeto de cima que contém o ponto (onde um boneco solto "entra"). */
export function containerAt<T extends RotatedRect & { id: string; z: number }>(point: Point, objects: T[]): T | null {
  const sorted = [...objects].sort((a, b) => b.z - a.z);
  return sorted.find((obj) => pointInRotatedRect(point, obj)) ?? null;
}

/** Ângulo entre -180 e 180 (para mostrar e para o servidor, que aceita de -360 a 360). */
export function normalizeAngle(degrees: number): number {
  const angle = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return Math.round(angle * 10) / 10;
}
