// Nós do Konva para a mesa: peças de cenário, objetos que carregam bonecos e a névoa de guerra.

import type { KonvaEventObject } from "konva/lib/Node";
import { memo, useMemo } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import useImage from "use-image";

import type { SceneImage, SceneObject } from "../api/types";
import { fogPixels } from "./fog";

interface PieceProps {
  piece: SceneImage;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragEnd: (id: string) => void;
}

/** Peça de cenário: posicionada pelo centro, girada; arrastável se não estiver travada. */
export const PieceNode = memo(function PieceNode({ piece, selected, onSelect, onDragEnd }: PieceProps) {
  const [image] = useImage(piece.url, "anonymous");
  const select = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    onSelect(piece.id, "shiftKey" in e.evt && e.evt.shiftKey);
  };
  return (
    <KonvaImage
      id={piece.id}
      name="piece"
      image={image}
      x={piece.x}
      y={piece.y}
      width={piece.width}
      height={piece.height}
      offsetX={piece.width / 2}
      offsetY={piece.height / 2}
      rotation={piece.rotation}
      draggable={!piece.locked}
      stroke={selected && piece.locked ? "#f2c14e" : undefined}
      strokeWidth={selected && piece.locked ? 2 : 0}
      strokeScaleEnabled={false}
      onMouseDown={select}
      onTap={select}
      onDragEnd={() => onDragEnd(piece.id)}
    />
  );
});

interface ObjectProps {
  obj: SceneObject;
  highlighted: boolean;
  occupants: number;
  onSelect: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

/** Objeto (carroça, barco, jaula): imagem ou caixa com o nome; quem está dentro anda junto. */
export const ObjectNode = memo(function ObjectNode({
  obj,
  highlighted,
  occupants,
  onSelect,
  onDragMove,
  onDragEnd,
}: ObjectProps) {
  const [image] = useImage(obj.url ?? "", "anonymous");
  const select = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    onSelect(obj.id);
  };
  const label = `${obj.name}${occupants ? ` (${occupants})` : ""}${obj.hide_occupants ? " · ocupantes ocultos" : ""}`;
  const fontSize = Math.max(12, Math.min(22, obj.height * 0.14));
  return (
    <Group
      id={obj.id}
      name="object"
      x={obj.x}
      y={obj.y}
      rotation={obj.rotation}
      draggable
      onMouseDown={select}
      onTap={select}
      onDragMove={(e: KonvaEventObject<DragEvent>) => onDragMove(obj.id, e.target.x(), e.target.y())}
      onDragEnd={(e: KonvaEventObject<DragEvent>) => onDragEnd(obj.id, e.target.x(), e.target.y())}
    >
      {image ? (
        <KonvaImage
          image={image}
          width={obj.width}
          height={obj.height}
          offsetX={obj.width / 2}
          offsetY={obj.height / 2}
        />
      ) : (
        <Rect
          width={obj.width}
          height={obj.height}
          offsetX={obj.width / 2}
          offsetY={obj.height / 2}
          cornerRadius={Math.min(obj.width, obj.height) * 0.12}
          fill="rgba(122, 86, 48, 0.55)"
          stroke="#c79a58"
          strokeWidth={3}
          strokeScaleEnabled={false}
        />
      )}
      {highlighted && (
        <Rect
          width={obj.width}
          height={obj.height}
          offsetX={obj.width / 2}
          offsetY={obj.height / 2}
          stroke="#f2c14e"
          strokeWidth={3}
          dash={[10, 6]}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      <Text
        text={label}
        y={-obj.height / 2 - fontSize * 1.4}
        width={Math.max(obj.width, 200)}
        offsetX={Math.max(obj.width, 200) / 2}
        align="center"
        fontSize={fontSize}
        fontStyle="bold"
        fill="#f3e3bf"
        stroke="#14100d"
        strokeWidth={3}
        fillAfterStrokeEnabled
        listening={false}
      />
    </Group>
  );
});

interface FogProps {
  bits: Uint8Array;
  cols: number;
  rows: number;
  cell: number;
  alpha: number;
}

/** Névoa: um pixel por célula, esticado sobre o mapa (a suavização deixa as bordas macias). */
export function FogOverlay({ bits, cols, rows, cell, alpha }: FogProps) {
  const canvas = useMemo(() => {
    const element = document.createElement("canvas");
    element.width = cols;
    element.height = rows;
    const context = element.getContext("2d");
    if (context) context.putImageData(new ImageData(fogPixels(bits, cols, rows, alpha), cols, rows), 0, 0);
    return element;
  }, [bits, cols, rows, alpha]);
  return <KonvaImage name="fog" image={canvas} width={cols * cell} height={rows * cell} listening={false} />;
}
