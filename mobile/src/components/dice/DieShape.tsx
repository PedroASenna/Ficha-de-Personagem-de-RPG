import Svg, { Circle, G, Line, Polygon } from 'react-native-svg';

type Shape =
  | { kind: 'polygon'; n: number; rotation: number; inner?: 'triangle' }
  | { kind: 'kite' }
  | { kind: 'coin' }
  | { kind: 'orb' };

/** Silhueta 2D de cada dado. Dados sem forma física comum (d5, d16, d24, d30, d60, d1000) viram "orbes". */
export function shapeFor(sides: number): Shape {
  switch (sides) {
    case 2:
      return { kind: 'coin' };
    case 4:
      return { kind: 'polygon', n: 3, rotation: -90 };
    case 6:
      return { kind: 'polygon', n: 4, rotation: 45 };
    case 8:
      return { kind: 'polygon', n: 4, rotation: -90 };
    case 10:
    case 100:
      return { kind: 'kite' };
    case 12:
      return { kind: 'polygon', n: 5, rotation: -90 };
    case 20:
      return { kind: 'polygon', n: 6, rotation: -90, inner: 'triangle' };
    default:
      return { kind: 'orb' };
  }
}

function polygonPoints(n: number, cx: number, cy: number, r: number, rotationDeg: number): string {
  return Array.from({ length: n }, (_, k) => {
    const a = ((rotationDeg + (360 * k) / n) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.3, 0.3], [0.7, 0.7]],
  3: [[0.3, 0.3], [0.5, 0.5], [0.7, 0.7]],
  4: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]],
  5: [[0.3, 0.3], [0.7, 0.3], [0.5, 0.5], [0.3, 0.7], [0.7, 0.7]],
  6: [[0.3, 0.28], [0.7, 0.28], [0.3, 0.5], [0.7, 0.5], [0.3, 0.72], [0.7, 0.72]],
};

type Props = {
  sides: number;
  size: number;
  face: string;
  edge: string;
  /** D6 "padrão" (pontos) mostra os pips; "numérico" mostra o número (desenhado por fora, em Text). */
  pips?: number | null;
  cracked?: boolean;
};

export function DieShape({ sides, size, face, edge, pips, cracked }: Props) {
  const c = size / 2;
  const r = size * 0.46;
  const shape = shapeFor(sides);
  const stroke = { stroke: edge, strokeWidth: Math.max(1.5, size * 0.04), strokeLinejoin: 'round' as const };

  let body;
  if (shape.kind === 'coin') {
    body = (
      <G>
        <Circle cx={c} cy={c} r={r} fill={face} {...stroke} />
        <Circle cx={c} cy={c} r={r * 0.72} fill="none" stroke={edge} strokeOpacity={0.5} strokeWidth={1} />
      </G>
    );
  } else if (shape.kind === 'orb') {
    body = (
      <G>
        <Circle cx={c} cy={c} r={r} fill={face} {...stroke} />
        <Circle cx={c} cy={c} r={r * 0.8} fill="none" stroke={edge} strokeOpacity={0.45} strokeDasharray="3 3" strokeWidth={1} />
      </G>
    );
  } else if (shape.kind === 'kite') {
    const points = `${c},${c - r} ${c + r * 0.9},${c - r * 0.1} ${c},${c + r} ${c - r * 0.9},${c - r * 0.1}`;
    body = <Polygon points={points} fill={face} {...stroke} />;
  } else {
    body = (
      <G>
        <Polygon points={polygonPoints(shape.n, c, c, r, shape.rotation)} fill={face} {...stroke} />
        {shape.inner === 'triangle' ? (
          <Polygon
            points={polygonPoints(3, c, c, r * 0.62, -90)}
            fill="none"
            stroke={edge}
            strokeOpacity={0.45}
            strokeWidth={1}
          />
        ) : null}
      </G>
    );
  }

  const pipLayout = sides === 6 && pips ? PIPS[pips] : undefined;

  return (
    <Svg width={size} height={size}>
      {body}
      {pipLayout?.map(([px, py], i) => (
        <Circle key={i} cx={size * 0.18 + px * size * 0.64} cy={size * 0.18 + py * size * 0.64} r={size * 0.06} fill={edge} />
      ))}
      {cracked ? (
        <G stroke="#FF3B30" strokeWidth={Math.max(1.5, size * 0.035)} strokeLinecap="round">
          <Line x1={c - r * 0.1} y1={c - r * 0.9} x2={c + r * 0.05} y2={c - r * 0.2} />
          <Line x1={c + r * 0.05} y1={c - r * 0.2} x2={c - r * 0.25} y2={c + r * 0.25} />
          <Line x1={c - r * 0.25} y1={c + r * 0.25} x2={c + r * 0.15} y2={c + r * 0.8} />
          <Line x1={c + r * 0.05} y1={c - r * 0.2} x2={c + r * 0.55} y2={c + r * 0.05} />
        </G>
      ) : null}
    </Svg>
  );
}
