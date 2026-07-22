import rawGameConfig from '../config/game.json' with { type: 'json' };
import type { ActionCategory, BoardObjectKind, TargetMode } from './types.js';

export const EFFECT_HANDLERS = [
  'charge', 'gain_charge', 'steal', 'double_steal', 'chop', 'wave', 'fist', 'slash',
  'defend', 'axe_defend', 'hangup', 'super_defend', 'heal', 'transform',
  'atomic_breath', 'raise_axe', 'collect_light', 'iridescence', 'hidden_cache',
  'particle_wall', 'winning_hand', 'stardust', 'forge_sword', 'forge_wall',
  'sovereign_blade', 'summon_forth',
  'ten_volt', 'hundred_thousand_volt', 'quick_attack', 'sword_aura', 'open_heaven_gate',
  'absorb_charge', 'aoao_divine', 'cut', 'shadow_blade', 'dream_path', 'dark_shelter',
  'silent_fear', 'haunting_shadows', 'rockfall_hammer', 'filthy_bloodline',
  'nightmare_dash',
  'continue_sleep',
  'immortal_palm', 'rule_the_world',
  'attack_order', 'defense_order', 'tactical_order', 'napoleon_strategy',
  'harmony_with_light', 'nebula_shock', 'create_star_core', 'transcend_fuse', 'transcend_detonate',
  'hollow_fist',
  'void_pierce', 'censure', 'redirect', 'see_through', 'shatter',
  'dissipation', 'collapsing_fear',
  'breathing_method', 'five_precepts', 'fire_purification', 'three_bodies',
  'soul_reap', 'soul_capture', 'intimidate', 'deify',
  'bleed', 'taunt', 'tremble', 'molten_fist', 'dismantle', 'bully',
  'regain_spirit', 'dominate', 'blood_wall', 'shred', 'body_slam',
] as const;
export type EffectHandlerId = typeof EFFECT_HANDLERS[number];

export interface ResourceDefinition {
  id: string;
  name: string;
  shortName: string;
  color: string;
  displayOrder: number;
  alwaysVisible?: boolean;
  characterIds?: string[];
}

export interface BuffDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
  scope?: 'character' | 'player';
  durationTurns?: number;
  grantedActionIds?: string[];
}

export interface PassiveDefinition {
  id: string;
  name: string;
  description: string;
}

export interface AssetDefinition { id: string; url: string; previewUrl?: string }
export interface BoardObjectDefinition {
  id: string;
  name: string;
  kind: BoardObjectKind;
  color: string;
  description: string;
  displayMode: 'marker' | 'stacks' | 'health';
  sourceLabel?: string;
  defaultAssetId?: string;
}
export type EffectKind = 'attack' | 'defense' | 'movement' | 'non_attack';
export interface EffectDefinition {
  handler: EffectHandlerId;
  /** Required on every component of a compound action. */
  kind?: EffectKind;
  /** Omit to inherit the action's speed; declare only a different base speed. */
  speedPriority?: number;
}
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
  /** Shared per-power level used when skill and damage levels are not split. */
  levelPerPower: number;
  skillLevelPerPower?: number;
  damageLevelPerPower?: number;
  minPower: number;
  maxPower?: number;
}

export interface DeferredFlexibleCostDefinition {
  resourceIds: string[];
  minPower: number;
  skillLevelOffset: number;
}

export interface RepeatAttackDefinition {
  baseHits: number;
  targetBuffId?: string;
  extraHitsWhenTargetBuffed?: number;
  actorBuffId?: string;
  hitsPerActorBuffStack?: number;
}

export interface DefenseBreakDefinition {
  mode: 'persistent' | 'recreated';
  brokenBuffId?: string;
}

export interface CooldownReductionDefinition {
  buffId: string;
  stacks: number;
}

export interface ActionDefinition {
  id: string;
  name: string;
  category: ActionCategory;
  description: string;
  cost: Record<string, number>;
  target: TargetDefinition;
  speedPriority: number;
  /** Shared level used when skillLevel/damageLevel are omitted. */
  level: number;
  skillLevel?: number;
  damageLevel?: number;
  effects: EffectDefinition[];
  vfxId: string;
  variable?: VariableActionDefinition;
  /** Marks an attack as repeated hits governed by the global multi-hit rules. */
  multiHit?: boolean;
  usesAllVariableResource?: boolean;
  /** Physical/magical taxonomy. It does not alter resolution yet. */
  damageAttribute?: 'physical' | 'magic';
  /** Defense interaction. Legacy generic/blunt/slash/magic values resolve as normal damage. */
  damageType?: 'normal' | 'piercing' | 'true' | 'generic' | 'blunt' | 'slash' | 'magic';
  anyResourceCost?: number;
  /** Power and exact mixed-resource payment are selected after actions are revealed. */
  deferredFlexibleCost?: DeferredFlexibleCostDefinition;
  /** Dynamic repeated hits resolved by the global multi-hit rules. */
  repeatAttack?: RepeatAttackDefinition;
  targetsGridCell?: boolean;
  optionalGridTarget?: boolean;
  /** Resolves before attacks at the same speed and can leave a planned target cell. */
  movement?: boolean;
  /** Follows the selected player instead of resolving against their planned cell. */
  locksTarget?: boolean;
  canSkipDeferred?: boolean;
  defenseBreak?: DefenseBreakDefinition;
  cooldownReduction?: CooldownReductionDefinition;
  napoleonSequence?: string;
  defenseLevel?: number;
  unlockRequirements?: {
    allBuffs?: string[];
    noneBuffs?: string[];
    minBuffStacks?: Record<string, number>;
    minResources?: Record<string, number>;
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
  passiveIds?: string[];
}

export interface GameConfig {
  version: number;
  resources: ResourceDefinition[];
  buffs: BuffDefinition[];
  passives: PassiveDefinition[];
  boardObjects: BoardObjectDefinition[];
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
  if (!Number.isInteger(config.version) || !Array.isArray(config.resources) || !Array.isArray(config.buffs) || !Array.isArray(config.passives) || !Array.isArray(config.boardObjects) || !Array.isArray(config.assets)
    || !Array.isArray(config.characters) || !Array.isArray(config.actions)) {
    throw new Error('Game config is missing required collections or version.');
  }
  assertUnique(config.resources, 'resource');
  assertUnique(config.buffs, 'buff');
  assertUnique(config.passives, 'passive');
  assertUnique(config.boardObjects, 'board object');
  assertUnique(config.assets, 'asset');
  assertUnique(config.characters, 'character');
  assertUnique(config.actions, 'action');
  const resourceIds = new Set(config.resources.map((item) => item.id));
  const characterIds = new Set(config.characters.map((item) => item.id));
  const buffIds = new Set(config.buffs.map((item) => item.id));
  const assetIds = new Set(config.assets.map((item) => item.id));
  const actionIds = new Set(config.actions.map((item) => item.id));
  const passiveIds = new Set(config.passives.map((item) => item.id));
  for (const object of config.boardObjects) {
    if (!['terrain', 'summon'].includes(object.kind) || !['marker', 'stacks', 'health'].includes(object.displayMode) || typeof object.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(object.color)) throw new Error(`Board object ${object.id} is invalid.`);
    if (object.defaultAssetId !== undefined && !assetIds.has(object.defaultAssetId)) throw new Error(`Board object ${object.id} references a missing asset.`);
  }
  for (const asset of config.assets) {
    if (typeof asset.url !== 'string' || !asset.url.startsWith('/') || (asset.previewUrl !== undefined && (typeof asset.previewUrl !== 'string' || !asset.previewUrl.startsWith('/')))) {
      throw new Error(`Asset ${asset.id} has an invalid URL.`);
    }
  }
  for (const resource of config.resources) {
    if (resource.alwaysVisible !== undefined && typeof resource.alwaysVisible !== 'boolean') throw new Error(`Resource ${resource.id} has invalid visibility.`);
    if (resource.characterIds?.some((characterId) => !characterIds.has(characterId))) throw new Error(`Resource ${resource.id} references a missing character.`);
  }
  for (const buff of config.buffs) {
    if (buff.scope && !['character', 'player'].includes(buff.scope)) throw new Error(`Buff ${buff.id} has an invalid scope.`);
    if (buff.durationTurns !== undefined && (!Number.isInteger(buff.durationTurns) || buff.durationTurns < 1)) throw new Error(`Buff ${buff.id} has an invalid duration.`);
    if (buff.grantedActionIds?.some((id) => !actionIds.has(id))) throw new Error(`Buff ${buff.id} grants a missing action.`);
  }
  for (const action of config.actions) {
    if (!categories.has(action.category)) throw new Error(`Action ${action.id} has an invalid category.`);
    if (action.damageAttribute && !['physical', 'magic'].includes(action.damageAttribute)) throw new Error(`Action ${action.id} has an invalid damage attribute.`);
    if (action.damageType && !['normal', 'piercing', 'true', 'generic', 'blunt', 'slash', 'magic'].includes(action.damageType)) throw new Error(`Action ${action.id} has an invalid damage type.`);
    if (action.movement !== undefined && typeof action.movement !== 'boolean') throw new Error(`Action ${action.id} has an invalid movement flag.`);
    if (action.locksTarget !== undefined && typeof action.locksTarget !== 'boolean') throw new Error(`Action ${action.id} has an invalid target lock flag.`);
    if (!Number.isFinite(action.level) || action.level < 0
      || (action.skillLevel !== undefined && (!Number.isFinite(action.skillLevel) || action.skillLevel < 0))
      || (action.damageLevel !== undefined && (!Number.isFinite(action.damageLevel) || action.damageLevel < 0))) {
      throw new Error(`Action ${action.id} has invalid skill or damage levels.`);
    }
    if (action.anyResourceCost !== undefined && (!Number.isInteger(action.anyResourceCost) || action.anyResourceCost < 1)) throw new Error(`Action ${action.id} has an invalid flexible cost.`);
    if (action.deferredFlexibleCost && (action.target.selectionTiming !== 'deferred'
      || action.target.mode !== 'single_enemy'
      || !Number.isInteger(action.deferredFlexibleCost.minPower) || action.deferredFlexibleCost.minPower < 1
      || !Number.isFinite(action.deferredFlexibleCost.skillLevelOffset)
      || action.deferredFlexibleCost.resourceIds.length === 0
      || action.deferredFlexibleCost.resourceIds.some((resourceId) => !resourceIds.has(resourceId)))) {
      throw new Error(`Action ${action.id} has an invalid deferred flexible cost.`);
    }
    if (action.repeatAttack && (action.category !== 'attack' || action.target.mode !== 'single_enemy'
      || !Number.isInteger(action.repeatAttack.baseHits) || action.repeatAttack.baseHits < 1
      || (action.repeatAttack.targetBuffId !== undefined && !buffIds.has(action.repeatAttack.targetBuffId))
      || (action.repeatAttack.extraHitsWhenTargetBuffed !== undefined && (!Number.isInteger(action.repeatAttack.extraHitsWhenTargetBuffed) || action.repeatAttack.extraHitsWhenTargetBuffed < 1))
      || (action.repeatAttack.actorBuffId !== undefined && !buffIds.has(action.repeatAttack.actorBuffId))
      || (action.repeatAttack.hitsPerActorBuffStack !== undefined && (!Number.isInteger(action.repeatAttack.hitsPerActorBuffStack) || action.repeatAttack.hitsPerActorBuffStack < 1)))) {
      throw new Error(`Action ${action.id} has an invalid repeat attack declaration.`);
    }
    if (action.defenseBreak) {
      const { mode, brokenBuffId } = action.defenseBreak;
      if ((action.category !== 'defense' && action.defenseLevel === undefined) || !['persistent', 'recreated'].includes(mode)
        || (mode === 'persistent' && (!brokenBuffId || !buffIds.has(brokenBuffId)))
        || (mode === 'recreated' && brokenBuffId !== undefined)) {
        throw new Error(`Action ${action.id} has an invalid defense break rule.`);
      }
    }
    if (action.cooldownReduction && (!buffIds.has(action.cooldownReduction.buffId)
      || !Number.isInteger(action.cooldownReduction.stacks) || action.cooldownReduction.stacks < 1)) {
      throw new Error(`Action ${action.id} has an invalid cooldown reduction.`);
    }
    if (action.napoleonSequence !== undefined && (!/^[ADT]{2,5}$/.test(action.napoleonSequence)
      || action.effects[0]?.handler !== 'napoleon_strategy')) throw new Error(`Action ${action.id} has an invalid Napoleon sequence.`);
    if (action.defenseLevel !== undefined && (!Number.isFinite(action.defenseLevel) || action.defenseLevel < 0)) throw new Error(`Action ${action.id} has an invalid defense level.`);
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
    if (action.multiHit !== undefined && (action.multiHit !== true || action.category !== 'attack'
      || action.target.mode !== 'multiple_enemies' || !action.target.maxTargetsByPower || !action.variable)) {
      throw new Error(`Action ${action.id} has an invalid multi-hit declaration.`);
    }
    if (!Number.isFinite(action.speedPriority) || action.speedPriority < 0 || action.speedPriority > 4) {
      throw new Error(`Action ${action.id} has an invalid speed.`);
    }
    if (!Array.isArray(action.effects) || action.effects.length === 0 || action.effects.some((effect) => !handlers.has(effect.handler))) {
      throw new Error(`Action ${action.id} references an unsupported effect handler.`);
    }
    const compoundEffect = action.effects.length > 1;
    for (const effect of action.effects) {
      if (effect.kind !== undefined && !['attack', 'defense', 'movement', 'non_attack'].includes(effect.kind)) {
        throw new Error(`Action ${action.id} has an invalid effect kind.`);
      }
      if (compoundEffect && effect.kind === undefined) {
        throw new Error(`Compound action ${action.id} must classify every effect.`);
      }
      if (effect.speedPriority !== undefined && (effect.kind === undefined
        || !Number.isFinite(effect.speedPriority) || effect.speedPriority < 0 || effect.speedPriority > 4
        || effect.speedPriority === action.speedPriority)) {
        throw new Error(`Action ${action.id} has an invalid effect speed override.`);
      }
    }
    for (const [resourceId, amount] of Object.entries(action.cost ?? {})) {
      if (!resourceIds.has(resourceId) || !Number.isFinite(amount) || amount < 0) {
        throw new Error(`Action ${action.id} has an invalid resource cost.`);
      }
    }
    if (action.variable && (!resourceIds.has(action.variable.resourceId)
      || !Number.isFinite(action.variable.costPerPower) || action.variable.costPerPower <= 0
      || !Number.isFinite(action.variable.levelPerPower) || action.variable.levelPerPower < 0
      || (action.variable.skillLevelPerPower !== undefined && (!Number.isFinite(action.variable.skillLevelPerPower) || action.variable.skillLevelPerPower < 0))
      || (action.variable.damageLevelPerPower !== undefined && (!Number.isFinite(action.variable.damageLevelPerPower) || action.variable.damageLevelPerPower < 0))
      || !Number.isInteger(action.variable.minPower) || action.variable.minPower < 1
      || (action.variable.maxPower !== undefined && (!Number.isInteger(action.variable.maxPower) || action.variable.maxPower < action.variable.minPower)))) {
      throw new Error(`Action ${action.id} has invalid variable parameters.`);
    }
    if (action.usesAllVariableResource && !action.variable) throw new Error(`Action ${action.id} must be variable to spend all of a resource.`);
    const requirements = action.unlockRequirements;
    const requiredBuffs = [...(requirements?.allBuffs ?? []), ...(requirements?.noneBuffs ?? []), ...Object.keys(requirements?.minBuffStacks ?? {})];
    const requiredResources = Object.entries(requirements?.minResources ?? {});
    if (requirements && (typeof requirements.description !== 'string'
      || !requirements.description.trim()
      || requiredBuffs.some((buffId) => !buffIds.has(buffId))
      || Object.values(requirements.minBuffStacks ?? {}).some((stacks) => !Number.isFinite(stacks) || stacks <= 0)
      || requiredResources.some(([resourceId, amount]) => !resourceIds.has(resourceId) || !Number.isFinite(amount) || amount <= 0))) {
      throw new Error(`Action ${action.id} has invalid unlock requirements.`);
    }
  }
  for (const character of config.characters) {
    if (character.description !== undefined && (typeof character.description !== 'string' || !character.description.trim())) {
      throw new Error(`Character ${character.id} has an invalid description.`);
    }
    if (!assetIds.has(character.defaultAssetId)) throw new Error(`Character ${character.id} references a missing asset.`);
    if (character.passiveIds?.some((id) => !passiveIds.has(id))) throw new Error(`Character ${character.id} references a missing passive.`);
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

export function effectSpeedPriority(action: ActionDefinition, kind: EffectKind): number {
  return action.effects.find((effect) => effect.kind === kind)?.speedPriority ?? action.speedPriority;
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
export const passiveById = new Map(gameConfig.passives.map((passive) => [passive.id, passive]));
export const boardObjectById = new Map(gameConfig.boardObjects.map((object) => [object.id, object]));
export const characterById = new Map(gameConfig.characters.map((character) => [character.id, character]));
export const assetById = new Map(gameConfig.assets.map((asset) => [asset.id, asset]));

export function isResourceVisibleForCharacter(resourceId: string, characterId: string, current: number): boolean {
  if (characterId === 'napoleon' && ['energy', 'charge'].includes(resourceId)) return false;
  const definition = resourceById.get(resourceId);
  return definition?.alwaysVisible === true || definition?.characterIds?.includes(characterId) === true || Math.abs(current) > 1e-6;
}

export type NapoleonCommand = 'A' | 'D' | 'T';

export function napoleonCommandForAction(actionId: string): NapoleonCommand | undefined {
  if (actionId === 'attack_order') return 'A';
  if (actionId === 'defense_order') return 'D';
  if (actionId === 'tactical_order') return 'T';
  return undefined;
}

export function canExecuteNapoleonStrategy(commandBuffer: string, sequence: string): boolean {
  return commandBuffer.includes(sequence);
}

export function napoleonStrategyFromCommand(commandBuffer: string, command: NapoleonCommand): ActionDefinition | undefined {
  const nextBuffer = `${commandBuffer}${command}`.slice(-6);
  return gameConfig.actions
    .filter((action) => action.napoleonSequence && nextBuffer.endsWith(action.napoleonSequence))
    .sort((left, right) => (right.napoleonSequence!.length - left.napoleonSequence!.length) || left.id.localeCompare(right.id))[0];
}
