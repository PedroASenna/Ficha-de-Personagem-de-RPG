import { create } from "zustand";

import { initialTableState, type TableAction, type TableState, tableReducer } from "./reducer";

export type Selection = { kind: "character" | "npc"; id: string; tokenId: string | null } | null;
export type ConnectionStatus = "connecting" | "online" | "offline" | "closed";

export type ClientMessage =
  | {
      type: "roll.request";
      id: string;
      notation: string;
      label?: string;
      visibility: "public" | "master_only";
      character_id?: string;
      npc_id?: string;
    }
  | { type: "hp.change"; delta: number; kind: "damage" | "heal" | "temp"; character_id?: string; npc_id?: string }
  | { type: "token.move"; token_id: string; x: number; y: number }
  | { type: "object.move"; object_id: string; x: number; y: number; rotation?: number };

interface TableStore extends TableState {
  status: ConnectionStatus;
  statusMessage: string | null;
  activeSceneId: string | null;
  selection: Selection;
  // Peças de cenário selecionadas (várias com Shift) e objeto selecionado: excluem a seleção de bonecos.
  selectedImages: string[];
  selectedObject: string | null;
  sender: ((message: ClientMessage) => boolean) | null;
  dispatch: (action: TableAction) => void;
  setStatus: (status: ConnectionStatus, message?: string | null) => void;
  setActiveScene: (sceneId: string | null) => void;
  select: (selection: Selection) => void;
  selectImages: (ids: string[]) => void;
  selectObject: (id: string | null) => void;
  setSender: (sender: TableStore["sender"]) => void;
  send: (message: ClientMessage) => boolean;
  reset: () => void;
}

/** Mantém a cena ativa e a seleção válidas depois de cada evento (cena apagada, boneco removido...). */
function reconcile(store: TableStore, next: TableState): Partial<TableStore> {
  let activeSceneId = store.activeSceneId;
  if (!activeSceneId || !next.scenes.some((s) => s.id === activeSceneId)) {
    activeSceneId = next.scenes[0]?.id ?? null;
  }
  let selection = store.selection;
  if (selection) {
    const exists =
      selection.kind === "npc" ? selection.id in next.npcs : next.party.some((p) => p.id === selection?.id);
    if (!exists) selection = null;
    else if (selection.tokenId && !(selection.tokenId in next.tokens)) selection = { ...selection, tokenId: null };
  }
  const selectedImages = store.selectedImages.filter((id) => id in next.images);
  const selectedObject = store.selectedObject && store.selectedObject in next.objects ? store.selectedObject : null;
  return {
    ...next,
    activeSceneId,
    selection,
    selectedImages: selectedImages.length === store.selectedImages.length ? store.selectedImages : selectedImages,
    selectedObject,
  };
}

export const useTable = create<TableStore>((set, get) => ({
  ...initialTableState,
  status: "connecting",
  statusMessage: null,
  activeSceneId: null,
  selection: null,
  selectedImages: [],
  selectedObject: null,
  sender: null,
  dispatch: (action) => {
    const store = get();
    const next = tableReducer(store, action);
    if (next !== store) set(reconcile(store, next));
  },
  setStatus: (status, message = null) => set({ status, statusMessage: message }),
  setActiveScene: (activeSceneId) => set({ activeSceneId, selection: null, selectedImages: [], selectedObject: null }),
  select: (selection) => set({ selection, selectedImages: [], selectedObject: null }),
  selectImages: (selectedImages) => set({ selectedImages, selection: null, selectedObject: null }),
  selectObject: (selectedObject) => set({ selectedObject, selection: null, selectedImages: [] }),
  setSender: (sender) => set({ sender }),
  send: (message) => get().sender?.(message) ?? false,
  reset: () =>
    set({
      ...initialTableState,
      status: "connecting",
      statusMessage: null,
      activeSceneId: null,
      selection: null,
      selectedImages: [],
      selectedObject: null,
    }),
}));

export function newRequestId(): string {
  return crypto.randomUUID();
}
