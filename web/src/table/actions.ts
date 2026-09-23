// Chamadas REST da mesa. As respostas chegam de volta pelo WebSocket (scene.*, token.*, npc.*),
// então aqui não mexemos no store — exceto posições, que já ficam no lugar para o arrasto não "pular".

import { api } from "../api/client";
import type { ImageUpload, Npc, Scene, Token } from "../api/types";
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

export function uploadImage(roomId: string, kind: "map" | "token", file: File): Promise<ImageUpload> {
  const form = new FormData();
  form.append("file", file);
  return api<ImageUpload>(`/rooms/${roomId}/images?kind=${kind}`, { form });
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
  body: Partial<Pick<Token, "scene_id" | "x" | "y" | "size" | "hidden" | "z">>,
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
