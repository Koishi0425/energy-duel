import rawGameConfig from '../config/game.json' with { type: 'json' };
import type { ActionCategory, TargetMode } from './types.js';

export const EFFECT_HANDLERS = [
  'charge', 'gain_charge', 'steal', 'double_steal', 'chop', 'wave', 'fist', 'slash',
  'defend', 'axe_defend', 'hangup', 'super_defend', 'heal', 'transform',
  'atomic_breath', 'raise_axe', 'collect_light', 'iridescence', 'hidden_cache',
  'particle_wall', 'winning_hand', 'stardust', 'forge_sword', 'forge_wall',
  'sovereign_blade', 'summon_forth',
] as const;
export type EffectHandlerId = typeof EFFECT_HANDLERS[number];

export interface ResourceDefinition {
  id: string;
  name: string;
  shortName: string;
  color: string;
  displayOrder: number;
}

export interface BuffDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
  scope?: 'character' | 'player';
  durationTurns?: number;
}

export interface AssetDefinition { id: string; url: string }
export interface EffectDefinition { handler: EffectHandlerId }
export interface TargetDefinition {
  mode: TargetMode;
  range?: number;
  maxTargets?: number;
  selectionTiming?: 'planned' | 'deferred';
  maxTargetsByPower?: boolean;
}

export interface VariableActionDefinition {
  resourceId: string;
  costPerPower: number;
  levelPerPower: number;
  minPower: number;
  maxPower?: number;
}

export interface ActionDefinition {
  id: string;
  name: string;
  category: ActionCategory;
  description: string;
  cost: Record<string, number>;
  target: TargetDefinition;
  speedPriority: number;
  level: number;
  effects: EffectDefinition[];
  vfxId: string;
  variable?: VariableActionDefinition;
  unlockRequirements?: {
    allBuffs?: string[];
    noneBuffs?: string[];
    minBuffStacks?: Record<string, number>;
    description: string;
  };
}

export interface FormDefinition {
  id: string;
  name: string;
  defaultAssetId: string;
  poses: Record<string, string>;
  unlockedActions: string[];
}

export interface CharacterDefinition {
  id: string;
  name: string;
  description?: string;
  defaultAssetId: string;
  forms: FormDefinition[];
  transformations: string[];
  transformationCost: Record<string, number>;
}

export interface GameConfig {
  version: number;
  resources: ResourceDefinition[];
  buffs: BuffDefinition[];
  assets: AssetDefinition[];
  characters: CharacterDefinition[];
  actions: ActionDefinition[];
}

const categories = new Set<ActionCategory>(['base', 'attack', 'defense', 'resource', 'special']);
const targetModes = new Set<TargetMode>(['none', 'single_enemy', 'multiple_enemies', 'all_enemies']);
const handlers = new Set<string>(EFFECT_HANDLERS);

export function validateGameConfig(input: unknown): GameConfig {
  if (!input || typeof input !== 'object') throw new Error('Game config must be an object.');
  const config = input as Partial<GameConfig>;
  if (!Number.isInteger(config.version) || !Array.isArray(config.resources) || !Array.isArray(config.buffs) || !Array.isArray(config.assets)
    || !Array.isArray(config.characters) || !Array.isArray(config.actions)) {
    throw new Error('Game config is missing required collections or version.');
  }
  assertUnique(config.resources, 'resource');
  assertUnique(config.buffs, 'buff');
  assertUnique(config.assets, 'asset');
  assertUnique(config.characters, 'character');
  assertUnique(config.actions, 'action');
  const resourceIds = new Set(config.resources.map((item) => item.id));
  const buffIds = new Set(config.buffs.map((item) => item.id));
  const assetIds = new Set(config.assets.map((item) => item.id));
  const actionIds = new Set(config.actions.map((item) => item.id));
  for (const buff of config.buffs) {
    if (buff.scope && !['character', 'player'].includes(buff.scope)) throw new Error(`Buff ${buff.id} has an invalid scope.`);
    if (buff.durationTurns !== undefined && (!Number.isInteger(buff.durationTurns) || buff.durationTurns < 1)) throw new Error(`Buff ${buff.id} has an invalid duration.`);
  }
  for (const action of config.actions) {
    if (!categories.has(action.category)) throw new Error(`Action ${action.id} has an invalid category.`);
    if (!targetModes.has(action.target?.mode)) throw new Error(`Action ${action.id} has an invalid target mode.`);
    if (action.target.selectionTiming && !['planned', 'deferred'].includes(action.target.selectionTiming)) {
      throw new Error(`Action ${action.id} has an invalid target selection timing.`);
    }
    if (action.target.mode === 'multiple_enemies' && !action.target.maxTargetsByPower
      && (!Number.isInteger(action.target.maxTargets) || (action.target.maxTargets ?? 0) < 2)) {
      throw new Error(`Action ${action.id} must define at least two targets.`);
    }
    if (action.target.maxTargetsByPower && (!action.variable || action.target.mode !== 'multiple_enemies')) {
      throw new Error(`Action ${action.id} has invalid power-based targets.`);
    }
    if (!Array.isArray(action.effects) || action.effects.some((effect) => !handlers.has(effect.handler))) {
      throw new Error(`Action ${action.id} references an unsupported effect handler.`);
    }
    for (const [resourceId, amount] of Object.entries(action.cost ?? {})) {
      if (!resourceIds.has(resourceId) || !Number.isFinite(amount) || amount < 0) {
        throw new Error(`Action ${action.id} has an invalid resource cost.`);
      }
    }
    if (action.variable && (!resourceIds.has(action.variable.resourceId)
      || !Number.isFinite(action.variable.costPerPower) || action.variable.costPerPower <= 0
      || !Number.isFinite(action.variable.levelPerPower) || action.variable.levelPerPower < 0
      || !Number.isInteger(action.variable.minPower) || action.variable.minPower < 1
      || (action.variable.maxPower !== undefined && (!Number.isInteger(action.variable.maxPower) || action.variable.maxPower < action.variable.minPower)))) {
      throw new Error(`Action ${action.id} has invalid variable parameters.`);
    }
    const requirements = action.unlockRequirements;
    const requiredBuffs = [...(requirements?.allBuffs ?? []), ...(requirements?.noneBuffs ?? []), ...Object.keys(requirements?.minBuffStacks ?? {})];
    if (requirements && (typeof requirements.description !== 'string'
      || !requirements.description.trim()
      || requiredBuffs.some((buffId) => !buffIds.has(buffId))
      || Object.values(requirements.minBuffStacks ?? {}).some((stacks) => !Number.isFinite(stacks) || stacks <= 0))) {
      throw new Error(`Action ${action.id} has invalid unlock requirements.`);
    }
  }
  for (const character of config.characters) {
    if (character.description !== undefined && (typeof character.description !== 'string' || !character.description.trim())) {
      throw new Error(`Character ${character.id} has an invalid description.`);
    }
    if (!assetIds.has(character.defaultAssetId)) throw new Error(`Character ${character.id} references a missing asset.`);
    assertUnique(character.forms, `form on ${character.id}`);
    for (const form of character.forms) {
      if (!assetIds.has(form.defaultAssetId) || form.unlockedActions.some((id) => !actionIds.has(id))) {
        throw new Error(`Form ${character.id}/${form.id} has a missing asset or action reference.`);
      }
      for (const assetId of Object.values(form.poses)) {
        if (!assetIds.has(assetId)) throw new Error(`Form ${character.id}/${form.id} references a missing pose asset.`);
      }
    }
    for (const targetCharacterId of character.transformations) {
      if (!config.characters.some((candidate) => candidate.id === targetCharacterId)) {
        throw new Error(`Character ${character.id} references a missing transformation.`);
      }
    }
    for (const [resourceId, amount] of Object.entries(character.transformationCost ?? {})) {
      if (!resourceIds.has(resourceId) || !Number.isFinite(amount) || amount < 0) throw new Error(`Character ${character.id} has an invalid transformation cost.`);
    }
  }
  return config as GameConfig;
}

function assertUnique(items: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error(`Duplicate or invalid ${label} id.`);
    ids.add(item.id);
  }
}

export const gameConfig = validateGameConfig(rawGameConfig);
export const actionById = new Map(gameConfig.actions.map((action) => [action.id, action]));
export const resourceById = new Map(gameConfig.resources.map((resource) => [resource.id, resource]));
export const buffById = new Map(gameConfig.buffs.map((buff) => [buff.id, buff]));
export const characterById = new Map(gameConfig.characters.map((character) => [character.id, character]));
export const assetById = new Map(gameConfig.assets.map((asset) => [asset.id, asset]));
