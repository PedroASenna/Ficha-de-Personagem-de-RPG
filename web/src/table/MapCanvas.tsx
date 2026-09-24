import AddPhotoIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import CenterFocusIcon from "@mui/icons-material/CenterFocusStrong";
import ObjectIcon from "@mui/icons-material/Inventory2Outlined";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type Konva from "konva";
import type { KonvaEventObject, Node as KonvaNode } from "konva/lib/Node";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Image as KonvaImage, Layer, Rect, Shape, Stage, Text, Transformer } from "react-konva";
import useImage from "use-image";
import { useShallow } from "zustand/react/shallow";

import type { Scene } from "../api/types";
import { toast } from "../toasts";
import {
  addSceneImage,
  deleteSceneImages,
  deleteSceneObject,
  placeToken,
  removeToken,
  updateScene,
  updateSceneImages,
  updateSceneObject,
  updateToken,
  uploadImage,
} from "./actions";
import { byteLength, union } from "./fog";
import {
  clampToMap,
  containerAt,
  fitView,
  normalizeAngle,
  type Point,
  screenToMap,
  snapPoint,
  type View,
  zoomAt,
} from "./geometry";
import { ObjectDialog } from "./ObjectDialog";
import { sceneImages, sceneObjects, sceneTokens } from "./reducer";
import { RotateImageDialog } from "./RotateImageDialog";
import { FogOverlay, ObjectNode, PieceNode } from "./SceneNodes";
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
const ROTATION_SNAPS = [0, 45, 90, 135, 180, 225, 270, 315];
// Opacidade do inexplorado na visão do Mestre ("leve transparência"); na prévia de um jogador é preto total.
const MASTER_FOG_ALPHA = 0.45;

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

type PendingUpload = { files: File[]; mode: "map" | "pieces"; at: Point };

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function MapCanvas({ roomId, scene }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [userView, setUserView] = useState<View | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [objectDrag, setObjectDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ tokenId: string; left: number; top: number } | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newObject, setNewObject] = useState<Point | null>(null);
  const [fogView, setFogView] = useState<string>("all");
  const lastMoveSent = useRef(0);
  const [mapImage] = useImage(scene.map_url ?? "", "anonymous");

  const tokens = useTable(useShallow((s) => sceneTokens(s, scene.id)));
  const pieces = useTable(useShallow((s) => sceneImages(s, scene.id)));
  const objects = useTable(useShallow((s) => sceneObjects(s, scene.id)));
  const objectsById = useTable((s) => s.objects);
  const sceneFog = useTable((s) => s.fog[scene.id]);
  const npcs = useTable((s) => s.npcs);
  const party = useTable((s) => s.party);
  const scenes = useTable((s) => s.scenes);
  const selection = useTable((s) => s.selection);
  const selectedImages = useTable((s) => s.selectedImages);
  const selectedObject = useTable((s) => s.selectedObject);
  const select = useTable((s) => s.select);
  const selectImages = useTable((s) => s.selectImages);
  const selectObject = useTable((s) => s.selectObject);
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
  const viewCenter = () => screenToMap({ x: size.width / 2, y: size.height / 2 }, view);

  const occupants = useMemo(() => {
    const count: Record<string, number> = {};
    for (const token of tokens)
      if (token.container_id) count[token.container_id] = (count[token.container_id] ?? 0) + 1;
    return count;
  }, [tokens]);

  const visuals = useMemo(
    () =>
      tokens.map((token) => {
        const visual = tokenVisual(token, npcs, party, selection, objectsById);
        if (drag?.id === token.id) return { ...visual, x: drag.x, y: drag.y };
        const carrier = objectDrag && token.container_id === objectDrag.id ? objectsById[objectDrag.id] : undefined;
        if (carrier && objectDrag) {
          return { ...visual, x: token.x + objectDrag.x - carrier.x, y: token.y + objectDrag.y - carrier.y };
        }
        return visual;
      }),
    [tokens, npcs, party, selection, objectsById, drag, objectDrag],
  );

  // Quem aparece na prévia da névoa: personagens com boneco nesta cena.
  const sceneCharacters = useMemo(
    () =>
      tokens
        .filter((t) => t.character_id)
        .map((t) => party.find((p) => p.id === t.character_id))
        .filter((p) => p !== undefined),
    [tokens, party],
  );
  const fogBits = useMemo(() => {
    if (!scene.fog_enabled || fogView === "hidden") return null;
    const length = byteLength(scene);
    const entries = sceneFog ?? {};
    if (fogView === "all") return union(Object.values(entries), length);
    return entries[fogView] ?? new Uint8Array(length);
  }, [scene, sceneFog, fogView]);

  // Transformador (girar/redimensionar) preso às peças selecionadas ou ao objeto selecionado.
  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    const locked = new Set(pieces.filter((p) => p.locked).map((p) => p.id));
    const ids = selectedObject ? [selectedObject] : selectedImages.filter((id) => !locked.has(id));
    const nodes = ids
      .map((id) => stage.findOne((node: KonvaNode) => node.id() === id))
      .filter((node): node is KonvaNode => node !== undefined);
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedImages, selectedObject, pieces, objects]);

  // ---------- bonecos ----------

  const onSelectToken = useCallback(
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

  const onTokenDragMove = useCallback(
    (tokenId: string, x: number, y: number) => {
      setDrag({ id: tokenId, x, y });
      setDropTarget(containerAt({ x, y }, objects)?.id ?? null);
      const now = performance.now();
      if (now - lastMoveSent.current >= MOVE_INTERVAL_MS) {
        lastMoveSent.current = now;
        send({ type: "token.move", token_id: tokenId, x, y });
      }
    },
    [send, objects],
  );

  const onTokenDragEnd = useCallback(
    (tokenId: string, x: number, y: number, freeMove: boolean): Point => {
      const token = useTable.getState().tokens[tokenId];
      const inside = clampToMap({ x, y }, scene.map_width, scene.map_height);
      const final = freeMove || !token ? inside : snapPoint(inside, scene.grid_size, token.size);
      // Solto em cima de um objeto: entra nele (e anda junto); fora de todos: sai.
      const container = containerAt(inside, objects);
      setDrag(null);
      setDropTarget(null);
      void updateToken(tokenId, { ...final, container_id: container?.id ?? null });
      return final;
    },
    [scene.map_width, scene.map_height, scene.grid_size, objects],
  );

  const onMenu = useCallback((tokenId: string, left: number, top: number) => setMenu({ tokenId, left, top }), []);

  // ---------- peças de cenário ----------

  const onSelectPiece = useCallback(
    (id: string, additive: boolean) => {
      const current = useTable.getState().selectedImages;
      if (additive) selectImages(current.includes(id) ? current.filter((i) => i !== id) : [...current, id]);
      else if (!current.includes(id)) selectImages([id]);
    },
    [selectImages],
  );

  /** Lê posição/tamanho/ângulo dos nós do Konva (depois de arrastar ou transformar) e salva. */
  const commitPieces = useCallback((ids: string[]) => {
    const stage = stageRef.current;
    if (!stage) return;
    const items = ids.flatMap((id) => {
      const node = stage.findOne((n: KonvaNode) => n.id() === id);
      if (!node) return [];
      const width = Math.max(4, node.width() * node.scaleX());
      const height = Math.max(4, node.height() * node.scaleY());
      node.setAttrs({ scaleX: 1, scaleY: 1, width, height, offsetX: width / 2, offsetY: height / 2 });
      return [
        {
          id,
          x: round1(node.x()),
          y: round1(node.y()),
          width: round1(width),
          height: round1(height),
          rotation: normalizeAngle(node.rotation()),
        },
      ];
    });
    if (items.length) void updateSceneImages(items);
  }, []);

  const onPieceDragEnd = useCallback(
    (id: string) => {
      const selected = useTable.getState().selectedImages;
      commitPieces(selected.includes(id) ? selected : [id]);
    },
    [commitPieces],
  );

  // ---------- objetos ----------

  const onSelectObject = useCallback((id: string) => selectObject(id), [selectObject]);

  const onObjectDragMove = useCallback(
    (id: string, x: number, y: number) => {
      setObjectDrag({ id, x, y });
      const now = performance.now();
      if (now - lastMoveSent.current >= MOVE_INTERVAL_MS) {
        lastMoveSent.current = now;
        send({ type: "object.move", object_id: id, x, y });
      }
    },
    [send],
  );

  const onObjectDragEnd = useCallback((id: string, x: number, y: number) => {
    setObjectDrag(null);
    void updateSceneObject(id, { x: round1(x), y: round1(y) });
  }, []);

  const onTransformEnd = () => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    if (selectedObject) {
      const node = transformer.nodes()[0];
      const obj = objectsById[selectedObject];
      if (!node || !obj) return;
      const width = Math.max(10, obj.width * node.scaleX());
      const height = Math.max(10, obj.height * node.scaleY());
      node.scale({ x: 1, y: 1 });
      void updateSceneObject(obj.id, {
        x: round1(node.x()),
        y: round1(node.y()),
        width: round1(width),
        height: round1(height),
        rotation: normalizeAngle(node.rotation()),
      });
      return;
    }
    commitPieces(transformer.nodes().map((node) => node.id()));
  };

  // ---------- zoom, arquivos, teclado ----------

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
      const token = await placeToken(roomId, {
        scene_id: scene.id,
        ...at,
        ...(payload.kind === "npc" ? { npc_id: payload.id } : { character_id: payload.id }),
      });
      const container = containerAt(point, objects);
      if (token && container) void updateToken(token.id, { container_id: container.id });
      return;
    }
    // Arquivos de imagem: numa cena sem mapa, o primeiro vira o mapa; senão viram peças de cenário.
    const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) setPending({ files, mode: !scene.map_url && files.length === 1 ? "map" : "pieces", at: point });
  };

  const uploadPending = async (rotations: number[]) => {
    if (!pending) return;
    setUploading(true);
    try {
      if (pending.mode === "map") {
        const image = await uploadImage(roomId, "map", pending.files[0] as File, rotations[0] ?? 0);
        await updateScene(scene.id, { map_key: image.key, map_width: image.width, map_height: image.height });
        setUserView(null);
      } else {
        const ids: string[] = [];
        const limit = Math.min(scene.map_width, scene.map_height) * 0.6;
        for (const [index, file] of pending.files.entries()) {
          const image = await uploadImage(roomId, "piece", file, rotations[index] ?? 0);
          const scale = Math.min(1, limit / Math.max(image.width, image.height));
          const offset = index * scene.grid_size;
          const at = clampToMap(
            { x: pending.at.x + offset, y: pending.at.y + offset },
            scene.map_width,
            scene.map_height,
          );
          const piece = await addSceneImage(scene.id, {
            image_key: image.key,
            ...at,
            width: round1(image.width * scale),
            height: round1(image.height * scale),
          });
          if (piece) ids.push(piece.id);
        }
        selectImages(ids);
      }
      setPending(null);
    } catch (error) {
      toast.error(error);
    } finally {
      setUploading(false);
    }
  };

  const onPickPieces = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    event.target.value = "";
    if (files.length) setPending({ files, mode: "pieces", at: viewCenter() });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    if (event.key === "Escape") select(null);
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const state = useTable.getState();
    if (state.selectedImages.length) {
      const count = state.selectedImages.length;
      if (window.confirm(count > 1 ? `Apagar ${count} peças de cenário?` : "Apagar esta peça de cenário?")) {
        void deleteSceneImages(state.selectedImages);
      }
    } else if (state.selectedObject) {
      const obj = state.objects[state.selectedObject];
      if (obj && window.confirm(`Apagar ${obj.name}? Quem está dentro fica no lugar.`)) void deleteSceneObject(obj.id);
    }
  };

  const closeMenu = () => setMenu(null);
  const menuContainer = menuToken?.container_id ? objectsById[menuToken.container_id] : undefined;

  return (
    <Box
      ref={containerRef}
      data-testid="map-canvas"
      tabIndex={0}
      onKeyDown={onKeyDown}
      sx={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", bgcolor: "#0f0c0a", outline: "none" }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {size.width > 0 && (
        <Stage
          ref={stageRef}
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
            containerRef.current?.focus({ preventScroll: true });
            if (target === target.getStage() || target.name() === "map-bg") select(null);
          }}
        >
          <Layer>
            {mapImage ? (
              <KonvaImage name="map-bg" image={mapImage} width={scene.map_width} height={scene.map_height} />
            ) : (
              <>
                <Rect name="map-bg" width={scene.map_width} height={scene.map_height} fill="#3b3026" />
                {!scene.map_url && pieces.length === 0 && (
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
            {pieces.map((piece) => (
              <PieceNode
                key={piece.id}
                piece={piece}
                selected={selectedImages.includes(piece.id)}
                onSelect={onSelectPiece}
                onDragEnd={onPieceDragEnd}
              />
            ))}
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
            {objects.map((obj) => (
              <ObjectNode
                key={obj.id}
                obj={obj}
                highlighted={dropTarget === obj.id}
                occupants={occupants[obj.id] ?? 0}
                onSelect={onSelectObject}
                onDragMove={onObjectDragMove}
                onDragEnd={onObjectDragEnd}
              />
            ))}
          </Layer>
          <Layer>
            {visuals.map((visual) => (
              <TokenNode
                key={visual.id}
                token={visual}
                grid={scene.grid_size}
                onSelect={onSelectToken}
                onDragMove={onTokenDragMove}
                onDragEnd={onTokenDragEnd}
                onMenu={onMenu}
              />
            ))}
          </Layer>
          {fogBits && (
            <Layer listening={false} imageSmoothingEnabled>
              <FogOverlay
                bits={fogBits}
                cols={scene.fog_cols}
                rows={scene.fog_rows}
                cell={scene.fog_cell}
                alpha={fogView === "all" ? MASTER_FOG_ALPHA : 1}
              />
            </Layer>
          )}
          <Layer>
            <Transformer
              ref={transformerRef}
              rotationSnaps={ROTATION_SNAPS}
              rotationSnapTolerance={4}
              flipEnabled={false}
              anchorSize={10}
              borderStroke="#f2c14e"
              anchorStroke="#f2c14e"
              anchorFill="#2a221c"
              ignoreStroke
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
              onTransformEnd={onTransformEnd}
            />
          </Layer>
        </Stage>
      )}

      <Paper
        elevation={4}
        sx={{ position: "absolute", left: 12, top: 12, display: "flex", alignItems: "center", gap: 0.5, p: 0.5 }}
      >
        <Button size="small" component="label" startIcon={<AddPhotoIcon />}>
          Imagens
          <input type="file" accept="image/*" multiple hidden data-testid="upload-pieces" onChange={onPickPieces} />
        </Button>
        <Button size="small" startIcon={<ObjectIcon />} onClick={() => setNewObject(viewCenter())}>
          Objeto
        </Button>
        {scene.fog_enabled && (
          <TextField
            select
            size="small"
            label="Névoa"
            value={fogView}
            onChange={(e) => setFogView(e.target.value)}
            sx={{ minWidth: 150, ml: 0.5 }}
            slotProps={{ htmlInput: { "data-testid": "fog-view" } }}
          >
            <MenuItem value="all">Grupo (translúcida)</MenuItem>
            {sceneCharacters.map((member) => (
              <MenuItem key={member.id} value={member.id}>
                Como {member.name} vê
              </MenuItem>
            ))}
            <MenuItem value="hidden">Esconder névoa</MenuItem>
          </TextField>
        )}
      </Paper>

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
        sx={{ position: "absolute", left: 12, bottom: 8, pointerEvents: "none", pr: 24 }}
      >
        Roda: zoom · arrastar o fundo: mover · Shift+clique: várias peças · soltar boneco num objeto: entra nele · Alt
        ao soltar: fora da grade · botão direito: opções · Delete: apagar peça/objeto
      </Typography>

      {pending && (
        <RotateImageDialog
          files={pending.files}
          busy={uploading}
          confirmLabel={
            pending.mode === "map"
              ? "Usar como mapa"
              : pending.files.length > 1
                ? `Colocar ${pending.files.length} imagens`
                : "Colocar na cena"
          }
          onCancel={() => setPending(null)}
          onConfirm={(rotations) => void uploadPending(rotations)}
        />
      )}
      {newObject && (
        <ObjectDialog open roomId={roomId} scene={scene} obj={null} at={newObject} onClose={() => setNewObject(null)} />
      )}

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
          <MenuItem
            key="rotate"
            onClick={() => {
              void updateToken(menuToken.id, { rotation: normalizeAngle((menuToken.rotation ?? 0) + 45) });
              closeMenu();
            }}
          >
            Girar retrato 45°
          </MenuItem>,
          menuContainer && (
            <MenuItem
              key="leave"
              onClick={() => {
                void updateToken(menuToken.id, { container_id: null });
                closeMenu();
              }}
            >
              Sair de {menuContainer.name}
            </MenuItem>
          ),
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
