import type { KonvaEventObject } from "konva/lib/Node";
import { memo } from "react";
import { Arc, Circle, Group, Text } from "react-konva";
import useImage from "use-image";

import { type Point, tokenRadius } from "./geometry";
import { hpColor } from "./rules";

export interface TokenVisual {
  id: string;
  x: number;
  y: number;
  size: number;
  label: string;
  imageUrl: string | null;
  ring: string;
  hp: number | null; // 0..1; null = sem barra
  hidden: boolean;
  selected: boolean;
}

interface Props {
  token: TokenVisual;
  grid: number;
  onSelect: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  /** Devolve a posição final (encaixada na grade), que o boneco assume na hora. */
  onDragEnd: (id: string, x: number, y: number, freeMove: boolean) => Point;
  onMenu: (id: string, clientX: number, clientY: number) => void;
}

function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** Boneco redondo: retrato, anel colorido (grupo/inimigo), arco de PV e nome. */
export const TokenNode = memo(function TokenNode({ token, grid, onSelect, onDragMove, onDragEnd, onMenu }: Props) {
  const [image] = useImage(token.imageUrl ?? "", "anonymous");
  const r = tokenRadius(token.size, grid);
  const ringWidth = Math.max(2.5, r * 0.09);
  const scale = image ? (2 * r) / Math.min(image.width, image.height) : 1;
  const fontSize = Math.max(11, Math.min(18, grid * 0.22));

  const select = () => onSelect(token.id);
  return (
    <Group
      name="token"
      x={token.x}
      y={token.y}
      draggable
      opacity={token.hidden ? 0.5 : 1}
      onMouseDown={select}
      onTap={select}
      onDragMove={(e: KonvaEventObject<DragEvent>) => onDragMove(token.id, e.target.x(), e.target.y())}
      onDragEnd={(e: KonvaEventObject<DragEvent>) => {
        e.target.position(onDragEnd(token.id, e.target.x(), e.target.y(), e.evt.altKey));
      }}
      onContextMenu={(e: KonvaEventObject<PointerEvent>) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        onSelect(token.id);
        onMenu(token.id, e.evt.clientX, e.evt.clientY);
      }}
      onMouseEnter={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "grab";
      }}
      onMouseLeave={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "default";
      }}
    >
      {token.selected && (
        <Circle radius={r + ringWidth * 2.2} stroke="#f2c14e" strokeWidth={2} shadowColor="#f2c14e" shadowBlur={14} />
      )}
      <Circle radius={r} fill="#2a221c" shadowColor="black" shadowBlur={8} shadowOpacity={0.6} shadowOffsetY={2} />
      {image ? (
        <Circle
          radius={r - ringWidth / 2}
          fillPatternImage={image}
          fillPatternRepeat="no-repeat"
          fillPatternScale={{ x: scale, y: scale }}
          fillPatternOffset={{ x: image.width / 2, y: image.height / 2 }}
        />
      ) : (
        <Text
          text={initials(token.label)}
          width={2 * r}
          height={2 * r}
          offsetX={r}
          offsetY={r}
          align="center"
          verticalAlign="middle"
          fontSize={r * 0.7}
          fontStyle="bold"
          fill="#f3e3bf"
        />
      )}
      <Circle radius={r} stroke={token.ring} strokeWidth={ringWidth} dash={token.hidden ? [8, 6] : undefined} />
      {token.hp !== null && (
        <Arc
          innerRadius={r + ringWidth * 0.6}
          outerRadius={r + ringWidth * 1.6}
          angle={Math.max(0.001, 360 * token.hp)}
          rotation={-90}
          fill={hpColor(token.hp)}
        />
      )}
      <Text
        text={token.hidden ? `${token.label} (escondido)` : token.label}
        y={r + ringWidth * 2}
        width={Math.max(4 * r, 140)}
        offsetX={Math.max(2 * r, 70)}
        align="center"
        fontSize={fontSize}
        fontStyle="bold"
        fill="#fff8e6"
        stroke="#14100d"
        strokeWidth={3}
        fillAfterStrokeEnabled
        listening={false}
      />
    </Group>
  );
});
