// Chamadas REST da mesa. As respostas chegam de volta pelo WebSocket (scene.*, token.*, npc.*),
// então aqui não mexemos no store — exceto posições, que já ficam no lugar para o arrasto não "pular".

import { api } from "../api/client";
import type {
  CharacterSheet,
  Faction,
  ImageUpload,
  Npc,
  Relation,
  RelationKind,
  Scene,
  SceneImage,
  SceneObject,
  Token,
  World,
} from "../api/types";
import { toast } from "../toasts";
import { useTable } from "./store";

export interface NpcForm {
  name: string;
  portrait_key: string | null;
  hp_max: number;
  armor_class: number | null;
  attributes: Record<string, number>;
  notes: string;
}

async function guarded<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    toast.error(error);
    return undefined;
  }
}

export type ImageKind = "map" | "token" | "piece" | "emblem";

/** Envia a imagem; `rotation` (graus, horário) é aplicada pelo servidor antes de gravar. */
export function uploadImage(roomId: string, kind: ImageKind, file: File, rotation = 0): Promise<ImageUpload> {
  const form = new FormData();
  form.append("file", file);
  const angle = Math.round(rotation * 10) / 10;
  return api<ImageUpload>(`/rooms/${roomId}/images?kind=${kind}&rotation=${angle}`, { form });
}

export async function createScene(roomId: string, body: Partial<Scene> & { name: string }) {
  const scene = await guarded(api<Scene>(`/rooms/${roomId}/scenes`, { json: body }));
  if (scene) {
    useTable.getState().dispatch({ type: "scene.upserted", scene });
    useTable.getState().setActiveScene(scene.id);
  }
  return scene;
}

export const updateScene = (sceneId: string, body: Partial<Scene>) =>
  guarded(api<Scene>(`/scenes/${sceneId}`, { method: "PATCH", json: body }));

export const deleteScene = (sceneId: string) => guarded(api(`/scenes/${sceneId}`, { method: "DELETE" }));

export const createNpcs = (roomId: string, body: NpcForm & { count: number }) =>
  guarded(api<Npc[]>(`/rooms/${roomId}/npcs`, { json: body }));

export const updateNpc = (npcId: string, body: Partial<NpcForm>) =>
  guarded(api<Npc>(`/npcs/${npcId}`, { method: "PATCH", json: body }));

export const deleteNpc = (npcId: string) => guarded(api(`/npcs/${npcId}`, { method: "DELETE" }));

export async function placeToken(
  roomId: string,
  body: { scene_id: string; x: number; y: number; character_id?: string; npc_id?: string; hidden?: boolean },
) {
  const token = await guarded(api<Token>(`/rooms/${roomId}/tokens`, { json: body }));
  if (token) useTable.getState().dispatch({ type: "token.upserted", token });
  return token;
}

export async function updateToken(
  tokenId: string,
  body: Partial<Pick<Token, "scene_id" | "x" | "y" | "size" | "hidden" | "z" | "rotation" | "container_id">>,
) {
  if (body.x !== undefined && body.y !== undefined) {
    useTable.getState().dispatch({ type: "local/token.position", token_id: tokenId, x: body.x, y: body.y });
  }
  const token = await guarded(api<Token>(`/tokens/${tokenId}`, { method: "PATCH", json: body }));
  if (token) useTable.getState().dispatch({ type: "token.upserted", token });
  return token;
}

export async function removeToken(tokenId: string) {
  const ok = await guarded(api(`/tokens/${tokenId}`, { method: "DELETE" }).then(() => true));
  if (ok) useTable.getState().dispatch({ type: "token.deleted", token_id: tokenId });
}

// ---------- peças de cenário ----------

export type PiecePatch = Partial<Pick<SceneImage, "x" | "y" | "width" | "height" | "rotation" | "z" | "locked">>;

export async function addSceneImage(
  sceneId: string,
  body: Pick<SceneImage, "image_key" | "x" | "y" | "width" | "height"> & { rotation?: number },
) {
  const image = await guarded(api<SceneImage>(`/scenes/${sceneId}/images`, { json: body }));
  if (image) useTable.getState().dispatch({ type: "image.upserted", image });
  return image;
}

/** Várias peças de uma vez; já aplica no painel para nada "pular" enquanto o servidor confirma. */
export async function updateSceneImages(items: (PiecePatch & { id: string })[]) {
  const { images, dispatch } = useTable.getState();
  for (const { id, ...patch } of items) {
    const current = images[id];
    if (current) dispatch({ type: "image.upserted", image: { ...current, ...patch } });
  }
  const saved = await guarded(api<SceneImage[]>(`/scene-images`, { method: "PATCH", json: { items } }));
  for (const image of saved ?? []) dispatch({ type: "image.upserted", image });
  return saved;
}

export async function deleteSceneImages(ids: string[]) {
  for (const id of ids) {
    const ok = await guarded(api(`/scene-images/${id}`, { method: "DELETE" }).then(() => true));
    if (ok) useTable.getState().dispatch({ type: "image.deleted", image_id: id });
  }
}

// ---------- objetos ----------

export type ObjectForm = Pick<SceneObject, "name" | "image_key" | "width" | "height" | "hide_occupants"> & {
  rotation?: number;
};

export async function addSceneObject(sceneId: string, body: ObjectForm & { x: number; y: number }) {
  const obj = await guarded(api<SceneObject>(`/scenes/${sceneId}/objects`, { json: body }));
  if (obj) useTable.getState().dispatch({ type: "object.upserted", object: obj, tokens: [] });
  return obj;
}

export async function updateSceneObject(
  objectId: string,
  body: Partial<
    Pick<SceneObject, "name" | "image_key" | "x" | "y" | "width" | "height" | "rotation" | "z" | "hide_occupants">
  >,
) {
  const { objects, dispatch } = useTable.getState();
  const current = objects[objectId];
  if (current && body.x !== undefined && body.y !== undefined) {
    dispatch({ type: "local/object.position", object_id: objectId, x: body.x, y: body.y });
  }
  return guarded(api<SceneObject>(`/scene-objects/${objectId}`, { method: "PATCH", json: body }));
}

export async function deleteSceneObject(objectId: string) {
  const ok = await guarded(api(`/scene-objects/${objectId}`, { method: "DELETE" }).then(() => true));
  if (ok) useTable.getState().dispatch({ type: "object.deleted", object_id: objectId });
}

// ---------- névoa ----------

export const resetFog = (sceneId: string, characterId: string | null = null) =>
  guarded(api(`/scenes/${sceneId}/fog/reset`, { json: { character_id: characterId } }));

// ---------- nível ----------

export const levelUp = (
  roomId: string,
  characterId: string,
  body: {
    attributes?: Record<string, number>;
    hp_gain?: number | null;
    experience?: number;
    expected_version?: number;
  },
) => guarded(api<CharacterSheet>(`/rooms/${roomId}/characters/${characterId}/level-up`, { json: body }));

// ---------- mapa-múndi ----------

export async function updateWorld(
  roomId: string,
  body: Partial<{ map_key: string | null; map_width: number; map_height: number; visible: boolean }>,
) {
  const world = await guarded(api<World>(`/rooms/${roomId}/world`, { method: "PATCH", json: body }));
  if (world) useTable.getState().dispatch({ type: "world.updated", world });
  return world;
}

export type FactionForm = Pick<
  Faction,
  | "kind"
  | "name"
  | "emblem_key"
  | "color"
  | "leader"
  | "seat"
  | "description"
  | "secret_notes"
  | "parent_id"
  | "revealed"
>;

export const createFaction = (roomId: string, body: FactionForm) =>
  guarded(api<Faction>(`/rooms/${roomId}/factions`, { json: body }));

export const updateFaction = (factionId: string, body: Partial<FactionForm> & { sort_order?: number }) =>
  guarded(api<Faction>(`/factions/${factionId}`, { method: "PATCH", json: body }));

export const deleteFaction = (factionId: string) => guarded(api(`/factions/${factionId}`, { method: "DELETE" }));

export const setRelation = (
  roomId: string,
  body: { a_id: string; b_id: string; kind: RelationKind; note: string; revealed: boolean },
) => guarded(api<Relation>(`/rooms/${roomId}/relations`, { method: "PUT", json: body }));

export const deleteRelation = (relationId: string) => guarded(api(`/relations/${relationId}`, { method: "DELETE" }));
