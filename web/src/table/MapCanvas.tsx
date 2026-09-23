import CenterFocusIcon from "@mui/icons-material/CenterFocusStrong";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { KonvaEventObject } from "konva/lib/Node";
import { type DragEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Rect, Shape, Stage, Text } from "react-konva";
import useImage from "use-image";
import { useShallow } from "zustand/react/shallow";

import type { Scene } from "../api/types";
import { toast } from "../toasts";
import { placeToken, removeToken, updateScene, updateToken, uploadImage } from "./actions";
import { clampToMap, fitView, type Point, screenToMap, snapPoint, type View, zoomAt } from "./geometry";
import { sceneTokens } from "./reducer";
import { useTable } from "./store";
import { TokenNode } from "./TokenNode";
import { DRAG_MIME, type DragPayload, tokenVisual } from "./tokens";

const SIZES: [number, string][] = [
  [0.5, "Minúsculo (½)"],
  [1, "Médio (1)"],
  [2, "Grande (2)"],
  [3, "Enorme (3)"],
  [4, "Colossal (4)"],
];
const MOVE_INTERVAL_MS = 90;

function GridLines({ scene }: { scene: Scene }) {
  const { map_width: width, map_height: height, grid_size: grid } = scene;
  return (
    <Shape
      listening={false}
      stroke="rgba(15, 10, 6, 0.45)"
      strokeWidth={1}
      strokeScaleEnabled={false}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        for (let x = grid; x < width; x += grid) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
        }
        for (let y = grid; y < height; y += grid) {
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
        }
        ctx.strokeShape(shape);
      }}
    />
  );
}

interface Props {
  roomId: string;
  scene: Scene;
}

export function MapCanvas({ roomId, scene }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [userView, setUserView] = useState<View | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ tokenId: string; left: number; top: number } | null>(null);
  const lastMoveSent = useRef(0);
  const [mapImage] = useImage(scene.map_url ?? "", "anonymous");

  const tokens = useTable(useShallow((s) => sceneTokens(s, scene.id)));
  const npcs = useTable((s) => s.npcs);
  const party = useTable((s) => s.party);
  const scenes = useTable((s) => s.scenes);
  const selection = useTable((s) => s.selection);
  const select = useTable((s) => s.select);
  const send = useTable((s) => s.send);
  const menuToken = useTable((s) => (menu ? s.tokens[menu.tokenId] : undefined));

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const view = userView ?? fitView(scene.map_width, scene.map_height, size.width || 1, size.height || 1);

  const visuals = useMemo(
    () =>
      tokens.map((token) => {
        const visual = tokenVisual(token, npcs, party, selection);
        return drag?.id === token.id ? { ...visual, x: drag.x, y: drag.y } : visual;
      }),
    [tokens, npcs, party, selection, drag],
  );

  const onSelect = useCallback(
    (tokenId: string) => {
      const token = useTable.getState().tokens[tokenId];
      if (!token) return;
      select(
        token.npc_id
          ? { kind: "npc", id: token.npc_id, tokenId }
          : { kind: "character", id: token.character_id as string, tokenId },
      );
    },
    [select],
  );

  const onDragMove = useCallback(
    (tokenId: string, x: number, y: number) => {
      setDrag({ id: tokenId, x, y });
      const now = performance.now();
      if (now - lastMoveSent.current >= MOVE_INTERVAL_MS) {
        lastMoveSent.current = now;
        send({ type: "token.move", token_id: tokenId, x, y });
      }
    },
    [send],
  );

  const onDragEnd = useCallback(
    (tokenId: string, x: number, y: number, freeMove: boolean): Point => {
      const token = useTable.getState().tokens[tokenId];
      const inside = clampToMap({ x, y }, scene.map_width, scene.map_height);
      const final = freeMove || !token ? inside : snapPoint(inside, scene.grid_size, token.size);
      setDrag(null);
      void updateToken(tokenId, final);
      return final;
    },
    [scene.map_width, scene.map_height, scene.grid_size],
  );

  const onMenu = useCallback((tokenId: string, left: number, top: number) => setMenu({ tokenId, left, top }), []);

  const onWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    setUserView(zoomAt(view, pointer, event.evt.deltaY > 0 ? 1 / 1.12 : 1.12));
  };

  const zoomCenter = (factor: number) => setUserView(zoomAt(view, { x: size.width / 2, y: size.height / 2 }, factor));

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = screenToMap({ x: event.clientX - rect.left, y: event.clientY - rect.top }, view);
    const raw = event.dataTransfer.getData(DRAG_MIME);
    if (raw) {
      const payload = JSON.parse(raw) as DragPayload;
      const at = snapPoint(clampToMap(point, scene.map_width, scene.map_height), scene.grid_size);
      await placeToken(roomId, {
        scene_id: scene.id,
        ...at,
        ...(payload.kind === "npc" ? { npc_id: payload.id } : { character_id: payload.id }),
      });
      return;
    }
    // Soltar um arquivo de imagem no mapa troca o mapa da cena.
    const file = Array.from(event.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (file) {
      try {
        toast.info("Enviando mapa…");
        const image = await uploadImage(roomId, "map", file);
        await updateScene(scene.id, { map_key: image.key, map_width: image.width, map_height: image.height });
        setUserView(null);
      } catch (error) {
        toast.error(error);
      }
    }
  };

  const closeMenu = () => setMenu(null);

  return (
    <Box
      ref={containerRef}
      data-testid="map-canvas"
      sx={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", bgcolor: "#0f0c0a" }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {size.width > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable
          onWheel={onWheel}
          onDragEnd={(e) => {
            const stage = e.target.getStage();
            if (stage && e.target === stage) setUserView({ ...view, x: stage.x(), y: stage.y() });
          }}
          onMouseDown={(e) => {
            const target = e.target;
            if (target === target.getStage() || target.name() === "map-bg") select(null);
          }}
        >
          <Layer>
            {mapImage ? (
              <KonvaImage name="map-bg" image={mapImage} width={scene.map_width} height={scene.map_height} />
            ) : (
              <>
                <Rect name="map-bg" width={scene.map_width} height={scene.map_height} fill="#3b3026" />
                {!scene.map_url && (
                  <Text
                    listening={false}
                    text={"Solte aqui a imagem do mapa desta cena\n(ou use o lápis na aba da cena)"}
                    width={scene.map_width}
                    y={scene.map_height / 2 - 40}
                    align="center"
                    fontSize={Math.max(18, scene.map_width / 40)}
                    fill="rgba(243, 227, 191, 0.55)"
                  />
                )}
              </>
            )}
            {scene.grid_visible && <GridLines scene={scene} />}
            <Rect
              listening={false}
              width={scene.map_width}
              height={scene.map_height}
              stroke="rgba(212, 166, 74, 0.35)"
              strokeWidth={2}
              strokeScaleEnabled={false}
            />
          </Layer>
          <Layer>
            {visuals.map((visual) => (
              <TokenNode
                key={visual.id}
                token={visual}
                grid={scene.grid_size}
                onSelect={onSelect}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                onMenu={onMenu}
              />
            ))}
          </Layer>
        </Stage>
      )}

      <Paper
        elevation={4}
        sx={{ position: "absolute", right: 12, bottom: 12, display: "flex", alignItems: "center", px: 0.5 }}
      >
        <Tooltip title="Aproximar">
          <IconButton aria-label="Aproximar" size="small" onClick={() => zoomCenter(1.25)}>
            <ZoomInIcon />
          </IconButton>
        </Tooltip>
        <Typography variant="caption" sx={{ minWidth: 40, textAlign: "center" }}>
          {Math.round(view.scale * 100)}%
        </Typography>
        <Tooltip title="Afastar">
          <IconButton aria-label="Afastar" size="small" onClick={() => zoomCenter(1 / 1.25)}>
            <ZoomOutIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Enquadrar o mapa">
          <IconButton aria-label="Enquadrar" size="small" onClick={() => setUserView(null)}>
            <CenterFocusIcon />
          </IconButton>
        </Tooltip>
      </Paper>
      <Typography
        variant="caption"
        color="text.disabled"
        sx={{ position: "absolute", left: 12, bottom: 8, pointerEvents: "none" }}
      >
        Roda do mouse: zoom · arrastar o fundo: mover · Alt ao soltar: fora da grade · botão direito: opções
      </Typography>

      <Menu
        open={menu !== null && menuToken !== undefined}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { left: menu.left, top: menu.top } : undefined}
        slotProps={{ list: { dense: true } }}
      >
        {menuToken && [
          <MenuItem
            key="hide"
            onClick={() => {
              void updateToken(menuToken.id, { hidden: !menuToken.hidden });
              closeMenu();
            }}
          >
            {menuToken.hidden ? "Mostrar aos jogadores" : "Esconder dos jogadores"}
          </MenuItem>,
          <MenuItem
            key="front"
            onClick={() => {
              const top = Math.max(0, ...tokens.map((t) => t.z));
              void updateToken(menuToken.id, { z: Math.min(100, top + 1) });
              closeMenu();
            }}
          >
            Trazer para a frente
          </MenuItem>,
          <Divider key="d1" />,
          <ListSubheader key="size-h">Tamanho</ListSubheader>,
          ...SIZES.map(([value, label]) => (
            <MenuItem
              key={`size-${value}`}
              selected={menuToken.size === value}
              onClick={() => {
                void updateToken(menuToken.id, { size: value });
                closeMenu();
              }}
            >
              {label}
            </MenuItem>
          )),
          scenes.length > 1 && <Divider key="d2" />,
          scenes.length > 1 && <ListSubheader key="scene-h">Mover para a cena</ListSubheader>,
          ...scenes
            .filter((s) => s.id !== menuToken.scene_id)
            .map((s) => (
              <MenuItem
                key={`scene-${s.id}`}
                onClick={() => {
                  void updateToken(menuToken.id, { scene_id: s.id });
                  closeMenu();
                }}
              >
                {s.name}
              </MenuItem>
            )),
          <Divider key="d3" />,
          <MenuItem
            key="remove"
            sx={{ color: "error.main" }}
            onClick={() => {
              void removeToken(menuToken.id);
              closeMenu();
            }}
          >
            Tirar do mapa
          </MenuItem>,
        ]}
      </Menu>
    </Box>
  );
}
