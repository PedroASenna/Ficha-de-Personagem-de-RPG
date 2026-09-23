import type { Npc, PartyMember, Token } from "../api/types";
import { hpRatio } from "./rules";
import type { Selection } from "./store";
import type { TokenVisual } from "./TokenNode";

export const DRAG_MIME = "application/x-rpgplay";
export type DragPayload = { kind: "character" | "npc"; id: string };

const PARTY_RING = "#4fb3a9";
const ENEMY_RING = "#e0584a";

export function tokenVisual(
  token: Token,
  npcs: Record<string, Npc>,
  party: PartyMember[],
  selection: Selection,
): TokenVisual {
  const base = {
    id: token.id,
    x: token.x,
    y: token.y,
    size: token.size,
    hidden: token.hidden,
    selected: selection?.tokenId === token.id,
  };
  if (token.npc_id) {
    const npc = npcs[token.npc_id];
    return {
      ...base,
      label: npc?.name ?? "Inimigo",
      imageUrl: npc?.portrait_url ?? null,
      ring: ENEMY_RING,
      hp: npc ? hpRatio(npc.hp_current, npc.hp_max) : null,
    };
  }
  const member = party.find((p) => p.id === token.character_id);
  return {
    ...base,
    label: member?.name ?? "Personagem",
    imageUrl: member?.portrait_url ?? null,
    ring: member ? PARTY_RING : "#6b6159",
    hp: member ? hpRatio(member.hp_current, member.hp_max) : null,
  };
}
