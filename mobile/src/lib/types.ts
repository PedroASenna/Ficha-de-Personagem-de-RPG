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
  engine?: RulesetEngine;
};

/** classic: raça/classe/antecedente (5ª edição, genérico); gurps e savage: ficha de pontos/dados. */
export type RulesetEngine = 'classic' | 'gurps' | 'savage';

export type TraitEffects = {
  charisma: number;
  parry: number;
  toughness: number;
  pace: number;
  bennies: number;
  attribute_points: number;
  skill_points: number;
  spell_bonus_per_level: number;
};

export type TraitKind = 'advantage' | 'disadvantage' | 'perk' | 'quirk' | 'edge' | 'hindrance' | 'power';

/** Custo em pontos (GURPS), como na lista do livro. */
export type TraitCost = {
  fixed: number | null;
  options: number[];
  min: number | null;
  max: number | null;
  per_level: number[];
  base: number;
  unit: string | null;
  variable: boolean;
  self_control: boolean;
};

export type TraitRequirements = {
  rank: number;
  wild_card: boolean;
  attributes: Record<string, number>;
  skills: Record<string, number>;
  edges: string[];
  other: string[];
  text: string;
};

export type TraitDef = {
  key: string;
  name: string;
  kind: TraitKind;
  category: string;
  tags: string[];
  cost: TraitCost | null;
  severity: 'minor' | 'major' | 'either' | null;
  requirements: TraitRequirements | null;
  effects: TraitEffects;
  info: Record<string, string>;
  page: string | null;
};

export type SkillDef = {
  key: string;
  name: string;
  attribute: string;
  difficulty: 'F' | 'M' | 'D' | 'MD' | null;
  default: number | null;
  specialize: boolean;
  category: string;
  group: string;
  page: string | null;
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
  /** Savage Worlds: efeitos da raça, Vantagens grátis, características e perícias que ela traz. */
  effects?: TraitEffects;
  free_edges?: number;
  granted_traits?: string[];
  free_skills?: Record<string, number>;
  page?: string | null;
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
  hp: { strategy: 'hit_die_max_plus_mod' | 'fixed' | 'manual' | 'engine' };
  level_up: { max_level: number; asi_levels: number[]; asi_points: number; attribute_max: number | null; free_points: boolean };
  dice: { default_check: string; direction: 'high' | 'low'; generic_crits: boolean; crit_rules: { sides: number; success: number[]; failure: number[] }[] };
  engine?: RulesetEngine;
  skills?: SkillDef[];
  traits?: TraitDef[];
  gurps?: { starting_points: number; disadvantage_limit_percent: number; quirk_limit: number } | null;
  savage?: { attribute_points: number; skill_points: number; ranks: string[]; bennies: number } | null;
};

/** Teste pronto calculado pelo servidor (GURPS: 3d6 contra o NH; Savage: dado + Dado Selvagem). */
export type SheetCheck = { key: string; label: string; notation: string; target?: number; wild?: boolean; group: string };

export type SheetDerived = { key: string; label: string; value: number | string; current?: number };

export type SheetTrait = {
  key: string;
  name: string;
  note: string;
  kind: TraitKind;
  cost?: number;
  severity?: 'minor' | 'major';
  source?: 'creation' | 'advance' | 'race';
  page: string | null;
  unmet?: string[];
  check?: string[];
  info?: Record<string, string>;
};

export type GurpsSheet = {
  engine: 'gurps';
  points: {
    total: number;
    starting: number;
    earned: number;
    spent: number;
    unspent: number;
    breakdown: { attributes: number; secondary: number; advantages: number; disadvantages: number; quirks: number; skills: number };
    disadvantages: number;
    disadvantage_limit: number;
    quirks: number;
    quirk_limit: number;
  };
  derived: SheetDerived[];
  traits: SheetTrait[];
  skills: { key: string; name: string; points: number; level: number; relative: string; difficulty: string; category: string; page: string | null }[];
  checks: SheetCheck[];
  warnings: string[];
};

export type SavageSheet = {
  engine: 'savage';
  rank: { index: number; name: string };
  xp: number;
  advances: { earned: number; taken: number; available: number };
  creation: {
    attributes: { spent: number; budget: number };
    skills: { spent: number; budget: number };
    edges: { taken: number; free: number };
    hindrances: { points: number; spent: number; majors: number; minors: number };
    funds: number;
  };
  derived: SheetDerived[];
  attributes: { key: string; name: string; die: number; label: string }[];
  skills: { key: string; name: string; die: number; label: string; attribute: string; category: string; page: string | null }[];
  traits: SheetTrait[];
  wounds: { max: number };
  fatigue: number;
  shaken: boolean;
  checks: SheetCheck[];
  warnings: string[];
};

export type EngineSheet = GurpsSheet | SavageSheet;

/** O que o jogador comprou (character.build). */
export type GurpsBuild = {
  points: number;
  earned: number;
  attributes: Record<string, number>;
  secondary: { hp: number; will: number; per: number; fp: number; speed: number; move: number };
  traits: { key: string; level: number; per: number | null; base_cost: number | null; self_control: number | null; note: string }[];
  skills: { key: string; points: number; note: string }[];
  fp_current: number | null;
};

export type SavageBuild = {
  attributes: Record<string, number>;
  skills: { key: string; die: number; note: string }[];
  traits: { key: string; severity: 'minor' | 'major' | null; source: 'creation' | 'advance' | 'race'; note: string }[];
  extra_funds: number;
  xp: number;
  advances: Record<string, unknown>[];
  bennies: number | null;
  fatigue: number;
  shaken: boolean;
};

export type AdvanceChoice = { type: 'edge' | 'attribute' | 'skill' | 'skills' | 'new_skill'; key?: string; keys?: string[]; note?: string };

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
  /** "Nível 3", "150 pontos" (GURPS) ou "Experiente" (Savage Worlds). */
  level_label?: string;
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
  build?: Record<string, unknown>;
  sheet?: EngineSheet | null;
};

export type RollPayload = {
  notation: string;
  terms: {
    notation: string;
    sign: number;
    /** Dado Selvagem do Savage Worlds. */
    wild?: boolean;
    /** rolls: cada lançamento de um dado que explodiu (a soma é o value). */
    dice: { sides: number; value: number; kept: boolean; rolls?: number[] }[];
    subtotal: number;
  }[];
  modifier: number;
  total: number;
};

/** Resultado de um teste (GURPS, Savage Worlds ou CD). */
export type CheckPayload = {
  kind: 'gurps' | 'savage' | 'classic';
  target: number;
  success: boolean;
  critical: boolean;
  margin?: number;
  raises?: number;
  wild?: boolean;
};

export type OutcomePayload = { tier: Tier; natural: number | null; intensity: number; effect: EffectPreset };

export type RollResponse = { roll: RollPayload; outcome: OutcomePayload; check?: CheckPayload | null };

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
  level_label?: string | null;
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
  check?: CheckPayload | null;
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
      level_label?: string | null;
      hp_gain: number;
      hp_current: number;
      hp_max: number;
      hp_temp: number;
      version: number;
      summary: string;
    });
