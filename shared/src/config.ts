import rawGameConfig from '../config/game.json' with { type: 'json' };
import type { ActionCategory, TargetMode } from './types.js';

export const EFFECT_HANDLERS = ['charge', 'steal', 'chop', 'wave', 'defend', 'hangup', 'super_defend'] as const;
export type EffectHandlerId = typeof EFFECT_HANDLERS[number];

export interface ResourceDefinition {
  id: string;
  name: string;
  shortName: string;
  color: string;
  displayOrder: number;
}

export interface AssetDefinition { id: string; url: string }
export interface EffectDefinition { handler: EffectHandlerId }
export interface TargetDefinition { mode: TargetMode; range?: number }

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
  defaultAssetId: string;
  forms: FormDefinition[];
  transformations: string[];
}

export interface GameConfig {
  version: number;
  resources: ResourceDefinition[];
  assets: AssetDefinition[];
  characters: CharacterDefinition[];
  actions: ActionDefinition[];
}

const categories = new Set<ActionCategory>(['attack', 'defense', 'special']);
const targetModes = new Set<TargetMode>(['none', 'single_enemy', 'all_enemies']);
const handlers = new Set<string>(EFFECT_HANDLERS);

export function validateGameConfig(input: unknown): GameConfig {
  if (!input || typeof input !== 'object') throw new Error('Game config must be an object.');
  const config = input as Partial<GameConfig>;
  if (!Number.isInteger(config.version) || !Array.isArray(config.resources) || !Array.isArray(config.assets)
    || !Array.isArray(config.characters) || !Array.isArray(config.actions)) {
    throw new Error('Game config is missing required collections or version.');
  }
  assertUnique(config.resources, 'resource');
  assertUnique(config.assets, 'asset');
  assertUnique(config.characters, 'character');
  assertUnique(config.actions, 'action');
  const resourceIds = new Set(config.resources.map((item) => item.id));
  const assetIds = new Set(config.assets.map((item) => item.id));
  const actionIds = new Set(config.actions.map((item) => item.id));
  for (const action of config.actions) {
    if (!categories.has(action.category)) throw new Error(`Action ${action.id} has an invalid category.`);
    if (!targetModes.has(action.target?.mode)) throw new Error(`Action ${action.id} has an invalid target mode.`);
    if (!Array.isArray(action.effects) || action.effects.some((effect) => !handlers.has(effect.handler))) {
      throw new Error(`Action ${action.id} references an unsupported effect handler.`);
    }
    for (const [resourceId, amount] of Object.entries(action.cost ?? {})) {
      if (!resourceIds.has(resourceId) || !Number.isFinite(amount) || amount < 0) {
        throw new Error(`Action ${action.id} has an invalid resource cost.`);
      }
    }
  }
  for (const character of config.characters) {
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
export const characterById = new Map(gameConfig.characters.map((character) => [character.id, character]));
export const assetById = new Map(gameConfig.assets.map((asset) => [asset.id, asset]));
