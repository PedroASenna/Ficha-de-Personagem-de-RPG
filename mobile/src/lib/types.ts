/** Tipos espelhando os schemas da API (backend/app/schemas). */
import type { EffectPreset, Tier } from './dice/effects';

export type UUID = string;

export type TokenPair = { access_token: string; refresh_token: string; expires_in: number };

export type User = { id: UUID; username: string; display_name: string; locale: string; is_admin: boolean; created_at: string };

export type RulesetStatus = 'available' | 'planned' | 'restricted';

export type RulesetSummary = {
  id: string;
  name: string;
  short_name?: string | null;
  version: string;
  status: RulesetStatus;
  license: string;
  license_url: string | null;
  attribution: string;
  description: string;
  notes?: string | null;
};

export type AttributeDef = { key: string; name: string; abbr: string };
export type Ancestry = {
  key: string;
  name: string;
  description: string;
  bonuses: Record<string, number>;
  bonus_choices: { count: number; amount: number; exclude: string[] } | null;
  speed: number | null;
  traits: string[];
};
export type CharacterClass = {
  key: string;
  name: string;
  description: string;
  hit_die: number | null;
  primary: string[];
  attribute_priority: string[];
  spell_slots_level1: Record<string, number>;
};
export type Background = { key: string; name: string; description: string; bonus_options: string[]; skills: string[] };

export type RulesetPack = {
  id: string;
  name: string;
  short_name: string;
  version: string;
  license: string;
  attribution: string;
  description: string;
  attributes: AttributeDef[];
  generation: {
    standard_array: number[] | null;
    point_buy: { budget: number; costs: Record<string, number> } | null;
    roll: string | null;
    manual: { min: number; max: number };
  };
  ancestry_label: string;
  background_label: string;
  ancestries: Ancestry[];
  classes: CharacterClass[];
  backgrounds: Background[];
  background_bonus: { strategy: 'none' | 'plus2_plus1' };
  allow_custom: boolean;
  /** Sistemas livres: pontos de atributo digitados para raça/origem personalizadas. */
  custom_bonus: { min: number; max: number } | null;
  custom_required: ('ancestry' | 'background')[];
  hp: { strategy: 'hit_die_max_plus_mod' | 'fixed' | 'manual' };
  level_up: { max_level: number; asi_levels: number[]; asi_points: number; attribute_max: number | null; free_points: boolean };
  dice: { default_check: string; direction: 'high' | 'low'; generic_crits: boolean; crit_rules: { sides: number; success: number[]; failure: number[] }[] };
};

export type AttributeMethod = 'standard_array' | 'point_buy' | 'roll' | 'class_preset' | 'manual';

export type Item = { id: UUID; name: string; quantity: number; weight_each: string; equipped: boolean };
export type Ability = {
  id: UUID;
  name: string;
  level: number;
  uses_max: number;
  uses_spent: number;
  recharge: 'short_rest' | 'long_rest' | 'none';
  available: boolean;
};

export type Character = {
  id: UUID;
  ruleset_id: string;
  status: 'draft' | 'complete';
  wizard_step: number;
  missing: string[];
  name: string;
  portrait_key: string | null;
  portrait_url: string | null;
  ancestry_key: string | null;
  ancestry_name: string | null;
  ancestry_choices: string[];
  ancestry_bonus: Record<string, number>;
  class_key: string | null;
  class_name: string | null;
  background_key: string | null;
  background_name: string | null;
  background_bonus: Record<string, number>;
  level: number;
  attributes: Record<string, number>;
  modifiers: Record<string, number>;
  attribute_method: AttributeMethod | null;
  attribute_audit: {
    method?: string;
    base?: Record<string, number>;
    bonuses?: Record<string, number>;
    rolls?: RollPayload[];
    advancement?: Record<string, number>;
    level_ups?: { level: number; attributes: Record<string, number>; hp: number | null }[];
  };
  hp_max: number;
  hp_current: number;
  hp_temp: number;
  spell_slots: Record<string, { max: number; used: number }>;
  conditions: string[];
  notes: string;
  version: number;
  items: Item[];
  abilities: Ability[];
  load: { total_weight: number; capacity: number; unit: string; encumbered: boolean; ratio: number };
};

export type RollPayload = {
  notation: string;
  terms: { notation: string; sign: number; dice: { sides: number; value: number; kept: boolean }[]; subtotal: number }[];
  modifier: number;
  total: number;
};

export type OutcomePayload = { tier: Tier; natural: number | null; intensity: number; effect: EffectPreset };

export type RollResponse = { roll: RollPayload; outcome: OutcomePayload };

export type RoomMember = {
  user_id: UUID;
  display_name: string;
  role: 'master' | 'player';
  online: boolean;
  character: {
    id: UUID;
    name: string;
    class_name: string | null;
    hp_current: number;
    hp_max: number;
    hp_temp: number;
    portrait_url: string | null;
    version: number;
  } | null;
};

export type Room = {
  id: UUID;
  pin: string;
  name: string;
  ruleset_id: string;
  ruleset_name: string;
  status: 'open' | 'closed';
  max_players: number;
  my_role: 'master' | 'player';
  members: RoomMember[];
  created_at: string;
};

export type SessionEvent = {
  id: number;
  type: 'dice_roll' | 'hp_change' | 'join' | 'leave' | 'rest' | 'level_up' | 'system';
  visibility: 'public' | 'master_only';
  actor_user_id: UUID | null;
  character_id: UUID | null;
  payload: { summary?: string; outcome?: OutcomePayload; [key: string]: unknown };
  created_at: string;
};

// ---- Mensagens do WebSocket (backend/app/ws/protocol.py) ----
type Base = { v: number; ts: string };
// ---------- mesa virtual (backend/app/services/table.py) ----------

export type Scene = {
  id: UUID;
  name: string;
  map_url: string | null;
  map_width: number;
  map_height: number;
  grid_size: number;
  grid_visible: boolean;
  sort_order: number;
  fog_enabled: boolean;
  fog_radius: number;
  fog_cols: number;
  fog_rows: number;
  fog_cell: number;
};

/** Peça de cenário (várias por cena): posição pelo centro, tamanho e rotação em graus (horário). */
export type SceneImage = {
  id: UUID;
  scene_id: UUID;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  version: number;
};

/** Objeto que carrega bonecos (carroça, barco, jaula). */
export type SceneObject = {
  id: UUID;
  scene_id: UUID;
  name: string;
  url: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  hide_occupants: boolean;
  version: number;
};

/** O que o personagem do jogador já explorou na cena (bits em base64). */
export type PlayerFog = { scene_id: UUID; character_id: UUID; explored: string };

export type FactionKind = 'nation' | 'faction';
export type RelationKind = 'alliance' | 'friendly' | 'neutral' | 'tense' | 'war';
export type PublicFaction = {
  id: UUID;
  kind: FactionKind;
  name: string;
  emblem_url: string | null;
  color: string;
  leader: string;
  seat: string;
  description: string;
  parent_id: UUID | null;
  sort_order: number;
};
export type PublicRelation = { id: UUID; a_id: UUID; b_id: UUID; kind: RelationKind; note: string };
/** Mapa-múndi como o jogador vê: só o que o Mestre revelou. */
export type PublicWorld = {
  map_url: string | null;
  map_width: number | null;
  map_height: number | null;
  visible: boolean;
  factions: PublicFaction[];
  relations: PublicRelation[];
};

export type TableToken = {
  id: UUID;
  scene_id: UUID;
  character_id: UUID | null;
  npc_id: UUID | null;
  x: number;
  y: number;
  size: number;
  hidden: boolean;
  z: number;
  rotation: number;
  container_id: UUID | null;
  version: number;
};

export type NpcCondition = 'ileso' | 'ferido' | 'muito_ferido' | 'caido';

/** O que o jogador sabe de um inimigo: nome, imagem e um estado vago. */
export type PublicNpc = { id: UUID; name: string; portrait_url: string | null; condition: NpcCondition; condition_label: string };

export type PartyMember = {
  id: UUID;
  owner_id: UUID;
  name: string;
  class_name: string | null;
  ancestry_name: string | null;
  level: number;
  portrait_url: string | null;
  hp_current: number;
  hp_max: number;
  hp_temp: number;
  version: number;
};

export type TableView =
  | {
      role: 'player';
      scene: Scene | null;
      tokens: TableToken[];
      npcs: PublicNpc[];
      images?: SceneImage[];
      objects?: SceneObject[];
      fog?: PlayerFog | null;
      party: PartyMember[];
      world?: PublicWorld;
    }
  | {
      role: 'master';
      scenes: Scene[];
      tokens: TableToken[];
      npcs: PublicNpc[];
      images?: SceneImage[];
      objects?: SceneObject[];
      party: PartyMember[];
      world?: PublicWorld;
    };

export type WelcomeMsg = Base & { type: 'welcome'; room: Room; log: SessionEvent[]; table: TableView };
export type PresenceMsg = Base & { type: 'presence'; user_id: UUID; display_name: string; online: boolean };
export type RollResultMsg = Base & {
  type: 'roll.result';
  event_id: number;
  visibility: 'public' | 'master_only';
  request_id: string;
  label: string | null;
  roll: RollPayload;
  outcome: OutcomePayload;
  actor: { user_id: UUID; display_name: string };
  character: { id: UUID; name: string } | null;
  summary: string;
};
export type HpChangedMsg = Base & {
  type: 'hp.changed';
  event_id: number;
  character_id: UUID;
  kind: 'damage' | 'heal' | 'temp' | 'rest';
  delta: number;
  hp_before: number;
  hp_current: number;
  hp_max: number;
  hp_temp: number;
  absorbed_by_temp: number;
  effect: 'bleed' | 'shield_hit' | 'heal_glow' | 'shield_up';
  version: number;
  character: { id: UUID; name: string };
  actor: { user_id: UUID; display_name: string };
  summary: string;
};
export type ErrorMsg = Base & { type: 'error'; code: string; message: string; ref: string | null };
export type ServerMessage =
  | WelcomeMsg
  | PresenceMsg
  | RollResultMsg
  | HpChangedMsg
  | ErrorMsg
  | (Base & { type: 'pong' })
  | (Base & { type: 'member.kicked'; user_id: UUID })
  | (Base & { type: 'room.closed' })
  | (Base & { type: 'view.reset'; table: TableView })
  | (Base & { type: 'scene.upserted'; scene: Scene })
  | (Base & { type: 'scene.deleted'; scene_id: UUID })
  | (Base & { type: 'token.upserted'; token: TableToken; npc?: PublicNpc })
  | (Base & { type: 'token.moved'; token_id: UUID; x: number; y: number; version: number })
  | (Base & { type: 'token.deleted'; token_id: UUID })
  | (Base & { type: 'npc.upserted'; npc: PublicNpc })
  | (Base & { type: 'npc.deleted'; npc_id: UUID })
  | (Base & { type: 'party.updated'; party: PartyMember[] })
  | (Base & { type: 'image.upserted'; image: SceneImage })
  | (Base & { type: 'image.deleted'; image_id: UUID })
  | (Base & { type: 'object.upserted'; object: SceneObject; tokens: { token_id: UUID; x: number; y: number; version: number }[] })
  | (Base & { type: 'object.deleted'; object_id: UUID })
  | (Base & { type: 'fog.revealed'; scene_id: UUID; character_id: UUID; cells: number[] })
  | (Base & { type: 'fog.reset'; scene_id: UUID; character_id: UUID | null })
  | (Base & { type: 'world.updated'; world: PublicWorld })
  | (Base & {
      type: 'character.leveled';
      event_id: number;
      character: { id: UUID; name: string };
      level: number;
      hp_gain: number;
      hp_current: number;
      hp_max: number;
      hp_temp: number;
      version: number;
      summary: string;
    });
