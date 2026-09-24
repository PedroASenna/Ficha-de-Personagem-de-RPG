// Formatos devolvidos pelo servidor RPG Play (backend/app/schemas e backend/app/services/table.py).

export interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  locale: string;
  is_admin: boolean;
  created_at: string;
}

export interface Discovery {
  app: "rpgplay";
  name: string;
  version: string;
  server_id: string;
  port: number;
  registration_open: boolean;
  master_path: string;
  addresses: string[];
}

export interface Ruleset {
  id: string;
  name: string;
  short_name: string | null;
  version: string;
  status: "available" | "planned" | "restricted";
  description: string;
  attribution: string;
}

export interface RoomMember {
  user_id: string;
  display_name: string;
  role: "master" | "player";
  online: boolean;
  character: { id: string; name: string; class_name: string | null; hp_current: number; hp_max: number } | null;
}

export interface Room {
  id: string;
  pin: string;
  name: string;
  ruleset_id: string;
  ruleset_name: string;
  status: "open" | "closed";
  max_players: number;
  my_role: "master" | "player";
  members: RoomMember[];
  created_at: string;
  last_activity_at: string | null;
}

export interface Scene {
  id: string;
  name: string;
  map_url: string | null;
  map_key: string | null;
  map_width: number;
  map_height: number;
  grid_size: number;
  grid_visible: boolean;
  sort_order: number;
  // Névoa de guerra: células de fog_cell px (fog_cols × fog_rows); fog_radius em casas da grade.
  fog_enabled: boolean;
  fog_radius: number;
  fog_cols: number;
  fog_rows: number;
  fog_cell: number;
}

/** Peça de cenário: imagem posicionada pelo centro, com tamanho e rotação em graus (horário). */
export interface SceneImage {
  id: string;
  scene_id: string;
  image_key: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  locked: boolean;
  version: number;
}

/** Objeto que carrega bonecos (carroça, barco, jaula). */
export interface SceneObject {
  id: string;
  scene_id: string;
  name: string;
  image_key: string | null;
  url: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  hide_occupants: boolean;
  version: number;
}

/** Exploração de um personagem numa cena: bits em base64 (1 = explorado), linha a linha. */
export interface FogEntry {
  scene_id: string;
  character_id: string;
  explored: string;
}

export type FactionKind = "nation" | "faction";
export type RelationKind = "alliance" | "friendly" | "neutral" | "tense" | "war";

export interface Faction {
  id: string;
  kind: FactionKind;
  name: string;
  emblem_key: string | null;
  emblem_url: string | null;
  color: string;
  leader: string;
  seat: string;
  description: string;
  secret_notes: string;
  parent_id: string | null;
  revealed: boolean;
  sort_order: number;
  version: number;
}

export interface Relation {
  id: string;
  a_id: string;
  b_id: string;
  kind: RelationKind;
  note: string;
  revealed: boolean;
  version: number;
}

export interface World {
  map_key: string | null;
  map_url: string | null;
  map_width: number | null;
  map_height: number | null;
  visible: boolean;
  factions: Faction[];
  relations: Relation[];
}

export type Condition = "ileso" | "ferido" | "muito_ferido" | "caido";

export interface Npc {
  id: string;
  name: string;
  portrait_url: string | null;
  portrait_key: string | null;
  hp_max: number;
  hp_current: number;
  hp_temp: number;
  armor_class: number | null;
  attributes: Record<string, number>;
  notes: string;
  version: number;
  condition: Condition;
  condition_label: string;
}

export interface Token {
  id: string;
  scene_id: string;
  character_id: string | null;
  npc_id: string | null;
  x: number;
  y: number;
  size: number;
  hidden: boolean;
  z: number;
  rotation: number;
  container_id: string | null;
  version: number;
}

export interface PartyMember {
  id: string;
  owner_id: string;
  name: string;
  class_name: string | null;
  ancestry_name: string | null;
  level: number;
  portrait_url: string | null;
  hp_current: number;
  hp_max: number;
  hp_temp: number;
  version: number;
}

export interface MasterTable {
  role: "master";
  scenes: Scene[];
  tokens: Token[];
  npcs: Npc[];
  images: SceneImage[];
  objects: SceneObject[];
  fog: FogEntry[];
  party: PartyMember[];
  world: World;
}

export interface SessionEvent {
  id: number;
  type: "dice_roll" | "hp_change" | "join" | "leave" | "rest" | "level_up" | "system";
  visibility: "public" | "master_only";
  actor_user_id: string | null;
  character_id: string | null;
  payload: Record<string, unknown> & { summary?: string };
  created_at: string;
}

export interface CharacterSheet {
  id: string;
  name: string;
  portrait_url: string | null;
  ancestry_name: string | null;
  class_name: string | null;
  background_name: string | null;
  level: number;
  attributes: Record<string, number>;
  modifiers: Record<string, number>;
  status: "draft" | "complete";
  hp_max: number;
  hp_current: number;
  hp_temp: number;
  conditions: string[];
  notes: string;
  version: number;
  items: { id: string; name: string; quantity: number; weight_each: string | number; equipped: boolean }[];
  abilities: { id: string; name: string; level: number; uses_max: number; uses_spent: number; available: boolean }[];
  load: { total_weight: number; capacity: number; unit: string; encumbered: boolean; ratio: number };
}

export interface ImageUpload {
  key: string;
  url: string;
  width: number;
  height: number;
}

export type RollTier = "critical_failure" | "low" | "neutral" | "high" | "critical_success";
