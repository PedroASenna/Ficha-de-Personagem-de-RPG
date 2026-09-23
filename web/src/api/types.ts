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
  party: PartyMember[];
}

export interface SessionEvent {
  id: number;
  type: "dice_roll" | "hp_change" | "join" | "leave" | "rest" | "system";
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
