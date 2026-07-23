import {
  actionById,
  canExecuteNapoleonStrategy,
  characterById,
  effectSpeedPriority,
  napoleonStrategyFromCommand,
  type ActionDefinition,
  type EffectKind,
  type EffectHandlerId,
  type ResolutionStep,
} from '@energy-duel/shared';

export interface CombatPlayer {
  id: string;
  nickname: string;
  resources: Record<string, number>;
  currentHp: number;
  maxHp: number;
  alive: boolean;
  gridIndex?: number;
  characterId?: string;
  currentFormId?: string;
  buffs?: Set<string>;
  buffStacks?: Record<string, number>;
  buffRemainingTurns?: Record<string, number>;
  buffSourcePlayerIds?: Record<string, string>;
  commandBuffer?: string;
  learnedActionIds?: string[];
  learnedPassiveIds?: string[];
}

export interface CombatBoardObject {
  objectId: string;
  definitionId: string;
  kind: 'terrain' | 'summon';
  ownerPlayerId: string;
  sourceCharacterId: string;
  gridIndex: number;
  stacks: number;
  currentHp: number;
  maxHp: number;
  remainingTurns: number;
  permanent: boolean;
  originGridIndex?: number;
  movementDirection?: -1 | 0 | 1;
  moveSpeed?: number;
  cargo?: Record<string, { energy: number; charge: number }>;
}

export interface SubmittedAction {
  actionId: string;
  targetId?: string;
  targetIds?: string[];
  /** Server-captured target cells at submission time. */
  targetGridIndices?: number[];
  transformCharacterId?: string;
  power?: number;
  targetGridIndex?: number;
  pathDirection?: -1 | 1;
  targetBoardObjectId?: string;
  resourceSpend?: Record<string, number>;
  extraResourceSpend?: Record<string, number>;
  controllerResourceGrant?: Record<string, number>;
  capturedSpeed?: number;
  resourceChoice?: 'energy' | 'charge';
  napoleonStrategySource?: 'buffer' | 'command';
  napoleonCommand?: 'A' | 'D' | 'T';
}

export interface RoundResult {
  summary: string[];
  eliminated: string[];
  steps: ResolutionStep[];
  performance: Record<string, RoundPerformance>;
  learningTargets: Array<{ learnerPlayerId: string; targetPlayerId: string }>;
}

export interface RoundPerformance {
  damageStatesDealt: number;
  eliminations: number;
  successfulDefenses: number;
  recoveryStates: number;
}

interface RoundDamageState {
  startingHp: number;
  highestLevel: number;
  lethalHeavyHit: boolean;
  outcome: DamageOutcome;
  grantedEnergy: boolean;
  transcendence?: 'temporary' | 'permanent';
  transcendenceProgress: number;
  transcendenceRemainingTurns?: number;
  createdDominionIds: string[];
  wuyouUsedBefore: boolean;
  bodhisattvaBefore: boolean;
  strengthBefore: number;
  shredCountBefore: number;
}

const roundDamageStates = new WeakMap<CombatPlayer, RoundDamageState>();
const roundBoardObjects = new WeakMap<CombatPlayer, Map<string, CombatBoardObject>>();
const roundBoardCellCounts = new WeakMap<CombatPlayer, number>();
const roundPlayers = new WeakMap<CombatPlayer, Map<string, CombatPlayer>>();
const roundFragilePlayers = new WeakMap<CombatPlayer, Set<string>>();
const roundDamageImmunePlayers = new WeakMap<CombatPlayer, Set<string>>();
const pendingWuyouRevives = new WeakSet<CombatPlayer>();
const roundLearningTargets = new WeakMap<CombatPlayer, Set<string>>();

export function validateAction(player: CombatPlayer, action: SubmittedAction, players: ReadonlyMap<string, CombatPlayer>, boardObjects: ReadonlyMap<string, CombatBoardObject> = new Map()): void {
  if (!player.alive) throw new Error('已淘汰玩家不能出招');
  const definition = requireAction(action.actionId);
  if (player.buffs?.has('fear') && action.actionId !== 'charge' && player.characterId !== 'napoleon') throw new Error('恐惧期间只能使用「气」');
  if (player.buffs?.has('defense_forbidden') && definition.category === 'defense') throw new Error('崩裂禁防期间不能使用防御技能');
  if (player.buffs?.has('attack_forbidden') && definition.category === 'attack') throw new Error('全面压制期间不能使用攻击技能');
  if (player.buffs?.has('regain_spirit_lock') && definition.category !== 'attack') throw new Error('重振精神期间只能使用攻击技能');
  if (definition.napoleonSequence) {
    if (action.napoleonStrategySource === 'buffer') {
      if (action.napoleonCommand !== undefined || !canExecuteNapoleonStrategy(player.commandBuffer ?? '', definition.napoleonSequence)) throw new Error('当前指令缓冲无法执行该策略');
    } else if (action.napoleonStrategySource === 'command') {
      const triggered = action.napoleonCommand && napoleonStrategyFromCommand(player.commandBuffer ?? '', action.napoleonCommand);
      if (!triggered || triggered.id !== definition.id) throw new Error('当前指令不会触发该策略');
    } else throw new Error('请选择已有策略或触发它的指令');
  } else if (action.napoleonStrategySource !== undefined || action.napoleonCommand !== undefined) throw new Error('该行动不接受拿破仑策略来源');
  if (hasPassive(player, 'devour_heaven') && action.actionId !== 'transform' && !['energy', 'charge'].includes(action.resourceChoice ?? '')) throw new Error('请选择吞天获得气或蓄力');
  if (hasPassive(player, 'sword_dao') && action.actionId === 'fist') throw new Error('剑道无法使用拳');
  if (hasPassive(player, 'shadow_blade_passive') && ['fist', 'slash'].includes(action.actionId)) throw new Error('暗影之刃无法使用拳或斩');
  const variable = definition.variable;
  if (variable) {
    if (!Number.isInteger(action.power) || (action.power ?? 0) < variable.minPower
      || (variable.maxPower !== undefined && (action.power ?? 0) > variable.maxPower)) throw new Error('请选择有效的技能参数 n');
    if (definition.usesAllVariableResource) {
      const allInPower = Math.floor((resourceValue(player, variable.resourceId) + 1e-6) / variable.costPerPower);
      if (action.power !== allInPower) throw new Error(`该行动必须消耗当前全部${variable.resourceId}资源`);
    }
  } else if (definition.deferredFlexibleCost) {
    if (actionTargets(action).length > 0 && (!Number.isInteger(action.power) || (action.power ?? 0) < definition.deferredFlexibleCost.minPower)) throw new Error('请选择有效的技能参数 X');
  } else if (action.power !== undefined) throw new Error('该行动不接受参数 n');
  if (action.actionId === 'transform') {
    const current = characterById.get(player.characterId ?? '');
    if (!action.transformCharacterId || action.transformCharacterId === 'default_character' || !current?.transformations.includes(action.transformCharacterId)) throw new Error('请选择有效的变身角色');
  } else if (action.transformCharacterId !== undefined) throw new Error('该行动不接受变身目标');
  const sacrifice = sacrificeResource(player, action);
  for (const [resourceId, amount] of Object.entries(costForSubmittedAction(player, action))) {
    if (resourceValue(player, resourceId) + 1e-6 < amount && sacrifice !== resourceId) throw new Error(`${resourceId}资源不足`);
  }
  validateFlexibleSpend(player, action, definition);
  validateDeferredFlexibleSpend(player, action, definition);
  validateHellwalkerSpend(player, action, definition);
  const targets = actionTargets(action);
  const boardTarget = action.targetBoardObjectId ? boardObjects.get(action.targetBoardObjectId) : undefined;
  if (action.targetBoardObjectId && (!boardTarget || boardTarget.definitionId !== 'lotus_seat' || boardTarget.currentHp <= 0
    || definition.category !== 'attack' || definition.target.mode !== 'single_enemy' || targets.length > 0)) throw new Error('请选择可被攻击的托生莲座');
  const deferredPending = (definition.target.selectionTiming === 'deferred'
    || (['steal', 'absorb_charge'].includes(action.actionId) && player.characterId === 'ao' && buffStacks(player, 'ao_mastery') >= 2)) && targets.length === 0;
  if (definition.target.mode === 'single_enemy') {
    if (!boardTarget && !deferredPending && targets.length !== 1) throw new Error('请选择其他存活玩家或托生莲座作为目标');
  } else if (definition.target.mode === 'multiple_enemies') {
    const expected = definition.target.maxTargetsByPower ? action.power : definition.target.maxTargets;
    if (!deferredPending && targets.length !== expected) throw new Error(`请选择 ${expected} 次目标`);
  } else if (targets.length > 0) throw new Error('该行动不接受单体目标');
  for (const targetId of targets) {
    const target = players.get(targetId);
    if (!target || !target.alive || target.id === player.id || target.buffs?.has('sleeping')) throw new Error('请选择其他可被选中的存活玩家作为目标');
  }
  if (definition.targetsGridCell && action.actionId === 'quick_attack') validateQuickAttackDestination(player, action.targetGridIndex, players, boardObjects);
  else if (action.actionId === 'breathing_method') {
    validateEmptyUnitGridTarget(action.targetGridIndex, players, boardObjects);
    if (Array.from(boardObjects.values()).some((object) => object.definitionId === 'nilu_fire' && object.ownerPlayerId === player.id && object.gridIndex === action.targetGridIndex)) throw new Error('该地块已有你的尼卢火');
  }
  else if (action.actionId === 'three_bodies') validateDirectionTarget(player, action.targetGridIndex, players);
  else if (definition.targetsGridCell) validateGridTarget(action.targetGridIndex, players);
  else if (definition.optionalGridTarget && action.targetGridIndex !== undefined) {
    validateGridTarget(action.targetGridIndex, players);
    if (!Array.from(boardObjects.values()).some((object) => object.definitionId === 'nilu_fire' && object.gridIndex === action.targetGridIndex)) throw new Error('请选择尼卢火所在的地块');
  }
  else if (action.targetGridIndex !== undefined && action.actionId !== 'dream_path') throw new Error('该行动不接受地块目标');
  if (action.actionId === 'dream_path') validateDreamPathSelection(player, players.get(targets[0]), action.targetGridIndex, action.pathDirection, players.size * 2);
}

function validateFlexibleSpend(player: CombatPlayer, action: SubmittedAction, definition: ActionDefinition): void {
  if (!definition.anyResourceCost) {
    if (action.resourceSpend !== undefined && !definition.deferredFlexibleCost) throw new Error('该行动不接受任意资源支付');
    return;
  }
  const required = Math.max(1, definition.anyResourceCost - (definition.id === 'aoao_divine' ? buffStacks(player, 'ao_mastery') : 0));
  const spend = action.resourceSpend ?? {};
  if (Math.abs(Object.values(spend).reduce((sum, value) => sum + value, 0) - required) > 1e-6) throw new Error(`请选择合计 ${required} 点资源`);
  for (const [resourceId, amount] of Object.entries(spend)) {
    if (!Number.isInteger(amount) || amount < 0 || resourceValue(player, resourceId) + 1e-6 < amount) throw new Error('任意资源支付必须使用整数点数');
  }
}

function validateAdjacentDestination(player: CombatPlayer, destination: number | undefined, players: ReadonlyMap<string, CombatPlayer>, boardObjects: ReadonlyMap<string, CombatBoardObject> = new Map()): void {
  const cellCount = players.size * 2;
  if (!Number.isInteger(destination) || destination! < 0 || destination! >= cellCount) throw new Error('请选择相邻地块');
  const current = player.gridIndex ?? 0;
  const adjacent = destination === (current + 1) % cellCount || destination === (current - 1 + cellCount) % cellCount;
  if (!adjacent) throw new Error('请选择相邻地块');
}

export function buildResolutionSteps(actions: ReadonlyMap<string, SubmittedAction>, players?: ReadonlyMap<string, CombatPlayer>): ResolutionStep[] {
  const ordered = Array.from(actions.entries()).sort(([leftId, left], [rightId, right]) => {
    const speedDifference = actionSpeed(rightId, right, players?.get(rightId), players, actions) - actionSpeed(leftId, left, players?.get(leftId), players, actions);
    return speedDifference || movementPriority(right) - movementPriority(left) || leftId.localeCompare(rightId);
  });
  const used = new Set<string>(); const steps: ResolutionStep[] = [];
  for (const [playerId, action] of ordered) {
    if (used.has(playerId)) continue;
    const definition = requireAction(action.actionId); const actors = [resolutionActor(playerId, action)];
    const primaryTarget = actors[0].targetIds[0]; let partnerId: string | undefined;
    if (primaryTarget && !used.has(primaryTarget)) {
      const reply = actions.get(primaryTarget);
      if (reply && (actionTargets(reply).includes(playerId) || actionTargets(reply).length === 0)) partnerId = primaryTarget;
    }
    if (!partnerId && actors[0].targetIds.length === 0) partnerId = ordered.find(([id, candidate]) => id !== playerId && !used.has(id) && actionTargets(candidate).includes(playerId))?.[0];
    if (!partnerId && actors[0].targetIds.length === 0) partnerId = ordered.find(([id, candidate]) => id !== playerId && !used.has(id) && requireAction(candidate.actionId).speedPriority === definition.speedPriority)?.[0];
    if (partnerId) { actors.push(resolutionActor(partnerId, actions.get(partnerId)!)); used.add(partnerId); }
    used.add(playerId);
    steps.push({ sequence: steps.length, speedPriority: actionSpeed(playerId, action, players?.get(playerId), players, actions), actors, participantIds: Array.from(new Set(actors.flatMap((actor) => [actor.playerId, ...actor.targetIds]))), durationMs: 650 });
  }
  return steps;
}

export function resolveRound(players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, boardObjects = new Map<string, CombatBoardObject>()): RoundResult {
  const summary: string[] = []; const eliminated = new Set<string>();
  const performance = Object.fromEntries(Array.from(players.keys(), (id) => [id, { damageStatesDealt: 0, eliminations: 0, successfulDefenses: 0, recoveryStates: 0 } satisfies RoundPerformance]));
  const aliveAtStart = Array.from(players.values()).filter((player) => player.alive);
  const damageImmune = new Set(aliveAtStart.filter((player) => primaryEffect(actions.get(player.id)) === 'super_defend' || player.buffs?.has('unbroken')).map((player) => player.id));
  const immune = new Set([
    ...damageImmune,
    ...aliveAtStart.filter((player) => primaryEffect(actions.get(player.id)) === 'soul_capture').map((player) => player.id),
  ]);
  const convertedAtStart = new Set(aliveAtStart.filter((player) => player.buffs?.has('converted')).map((player) => player.id));
  const resourcesAtSubmission = new Map(aliveAtStart.map((player) => [player.id, Object.values(player.resources).reduce((sum, value) => sum + value, 0)]));
  for (const action of actions.values()) {
    action.targetGridIndices ??= actionTargets(action)
      .map((targetId) => players.get(targetId)?.gridIndex)
      .filter((cell): cell is number => cell !== undefined);
  }
  for (const player of aliveAtStart) {
    roundDamageStates.delete(player); pendingWuyouRevives.delete(player); roundBoardObjects.set(player, boardObjects);
    roundBoardCellCounts.set(player, players.size * 2); roundPlayers.set(player, players); roundLearningTargets.set(player, new Set()); roundDamageImmunePlayers.set(player, damageImmune); syncNiluResistance(player);
  }
  const hpAtStart = new Map(aliveAtStart.map((player) => [player.id, player.currentHp]));
  for (const player of aliveAtStart) if (player.characterId === 'napoleon') {
    if (player.buffs?.has('napoleon_emperor')) addTacticalAdvantage(player, 2, Math.max(1, player.buffRemainingTurns?.napoleon_emperor ?? 1));
    if (player.buffs?.has('hundred_days')) addTacticalAdvantage(player, 1, 1);
    if (player.buffs?.has('unfallen_fortress')) addTacticalAdvantage(player, 1, Math.max(1, player.buffRemainingTurns?.unfallen_fortress ?? 1));
  }
  summary.push(`本回合行动：${aliveAtStart.map((player) => describeSubmittedAction(player, actions.get(player.id), players)).join('；')}。`);

  for (const player of aliveAtStart) {
    const action = actions.get(player.id); if (!action) continue;
    const controller = players.get(player.buffSourcePlayerIds?.converted ?? '');
    for (const [resourceId, amount] of Object.entries(action.controllerResourceGrant ?? {})) {
      if (!controller || amount <= 0) continue;
      controller.resources.soul = resourceValue(controller, 'soul') - amount;
      gainResource(player, resourceId, amount);
    }
    if (player.buffs?.has('sleeping') && !['continue_sleep', 'filthy_bloodline'].includes(action.actionId)) wakeMudrock(player, true, summary);
    const sacrifice = sacrificeResource(player, action); const hpBeforeSacrifice = player.currentHp;
    for (const [resourceId, amount] of Object.entries(costForSubmittedAction(player, action))) player.resources[resourceId] = Math.max(0, resourceValue(player, resourceId) - amount);
    if (sacrifice) { player.currentHp -= 1; summary.push(`${player.nickname} 以祭道抵免 1 点${sacrifice === 'energy' ? '气' : '蓄力'}缺口，进入${healthStateName(player)}。`); if (player.currentHp <= 0 && !queueWuyouRevive(player)) { player.alive = false; eliminated.add(player.id); } }
    const strategy = requireAction(action.actionId).napoleonSequence;
    if (strategy) player.commandBuffer = consumeNapoleonStrategy(player.commandBuffer ?? '', strategy, action.napoleonStrategySource === 'command' ? action.napoleonCommand : undefined);
    for (const [resourceId, amount] of Object.entries(action.resourceSpend ?? {})) player.resources[resourceId] = resourceValue(player, resourceId) - amount;
    for (const [resourceId, amount] of Object.entries(action.extraResourceSpend ?? {})) player.resources[resourceId] = resourceValue(player, resourceId) - amount;
    if (sacrifice && hpBeforeSacrifice > 1 && player.currentHp === 1 && player.alive) { gainResource(player, 'energy', 1); summary.push(`${player.nickname} 因祭道进入濒死，获得 1 气。`); }
    if (action.actionId === 'filthy_bloodline') { setBuff(player, 'sleeping', 2); setBuff(player, 'sleep_progress', 1); }
  }

  countMudrockSelections(players, actions);
  const hasChop = aliveAtStart.some((player) => primaryEffect(actions.get(player.id)) === 'chop');
  const hasCut = aliveAtStart.some((player) => primaryEffect(actions.get(player.id)) === 'cut');
  const fragile = new Set(aliveAtStart.filter((player) => {
    const action = actions.get(player.id); const effect = primaryEffect(action);
    const extinguishesFire = effect === 'heal' && action?.targetGridIndex !== undefined && Array.from(boardObjects.values()).some((object) => object.definitionId === 'nilu_fire' && object.gridIndex === action.targetGridIndex);
    return !extinguishesFire && ['fist', 'double_steal', 'heal', 'winning_hand'].includes(effect ?? '') && !hasPassive(player, 'child_of_earth');
  }).map((player) => player.id));
  for (const player of aliveAtStart) roundFragilePlayers.set(player, fragile);
  const blockers = new Map(aliveAtStart.flatMap((player) => {
    const action = actions.get(player.id); const definition = action && requireAction(action.actionId); return definition && (definition.category === 'defense' || definition.defenseLevel !== undefined) ? [[player.id, definition]] as const : [];
  }));
  const darkShelterAbsorbs = chooseDarkShelterAbsorbs(players, actions);
  const attackAttempts = new Set<string>(); const canceledAttackTargets = new Set<string>(); const canceledActors = new Set<string>(); const canceledReasons = new Map<string, string>(); const processed = new Set<string>();

  if (hasChop) resolveGlobalCounter(['steal', 'double_steal'], '凹类技能', '剁', 'chop', aliveAtStart, actions, eliminated, summary);
  if (hasChop) for (const actor of aliveAtStart.filter((player) => hasPassive(player, 'tempered_passive') && primaryEffect(actions.get(player.id)) === 'chop')) {
    const successes = aliveAtStart.filter((player) => ['steal', 'double_steal'].includes(primaryEffect(actions.get(player.id)) ?? '')).length;
    for (let index = 0; index < successes; index += 1) rewardTempered(actor, summary);
  }
  if (hasCut) resolveGlobalCounter(['absorb_charge'], '吸', '削', 'cut', aliveAtStart, actions, eliminated, summary, fragile);

  const suppressedCharges = new Set<string>(); const absorbClaims = new Set<string>(); const preclaimedResources = new Set<string>();
  if (!hasChop) for (const actor of aliveAtStart) {
    const submitted = actions.get(actor.id); const effect = primaryEffect(submitted); if (!submitted || !['steal', 'double_steal'].includes(effect ?? '')) continue;
    const allocationsByTarget = new Map<string, number>();
    for (const targetId of actionTargets(submitted)) {
      const target = players.get(targetId);
      if (primaryEffect(actions.get(targetId)) === 'charge') {
        const priorAllocations = allocationsByTarget.get(targetId) ?? 0; allocationsByTarget.set(targetId, priorAllocations + 1);
        const overdrafts = effect === 'double_steal' && priorAllocations > 0;
        suppressedCharges.add(targetId);
        const bonus = hasPassive(actor, 'resentment_passive') && target?.buffs?.has('resentment_mark') ? 1 : 0;
        const amount = 1 + bonus; gainResource(actor, 'energy', amount);
        if (overdrafts && target) target.resources.energy = Math.max(0, resourceValue(target, 'energy') - 1);
        preclaimedResources.add(actor.id); summary.push(`${actor.nickname} 的${requireAction(submitted.actionId).name}对 ${target?.nickname ?? targetId} 生效，获得 ${amount} 气${overdrafts ? `，并倒扣 ${target?.nickname ?? targetId} 1 气` : ''}。`); if (hasPassive(actor, 'tempered_passive')) rewardTempered(actor, summary);
      } else summary.push(`${actor.nickname} 的${requireAction(submitted.actionId).name}没有从 ${target?.nickname ?? targetId} 获得气：目标本回合没有出气。`);
    }
  }
  if (!hasCut) for (const actor of aliveAtStart) {
    const submitted = actions.get(actor.id); if (!submitted || primaryEffect(submitted) !== 'absorb_charge') continue;
    const targetId = actionTargets(submitted)[0]; const target = players.get(targetId);
    if (targetId && primaryEffect(actions.get(targetId)) === 'gain_charge' && !absorbClaims.has(targetId)) { absorbClaims.add(targetId); const bonus = hasPassive(actor, 'resentment_passive') && target?.buffs?.has('resentment_mark') ? 1 : 0; gainResource(actor, 'charge', 1 + bonus); if (bonus && target) target.resources.charge = Math.max(0, resourceValue(target, 'charge') - 1); preclaimedResources.add(actor.id); summary.push(`${actor.nickname} 从 ${target?.nickname ?? targetId} 吸取 ${1 + bonus} 蓄力。`); if (hasPassive(actor, 'tempered_passive')) rewardTempered(actor, summary); }
    else summary.push(`${actor.nickname} 的吸没有获得蓄力。`);
  }

  const ordered = aliveAtStart.filter((player) => actions.has(player.id)).sort((left, right) => {
    const speed = actionSpeed(right.id, actions.get(right.id)!, right, players, actions) - actionSpeed(left.id, actions.get(left.id)!, left, players, actions);
    return speed || movementPriority(actions.get(right.id)!) - movementPriority(actions.get(left.id)!) || left.id.localeCompare(right.id);
  });
  const pendingRockfallRecoveries = aliveAtStart
    .filter((player) => actions.get(player.id)?.actionId === 'rockfall_hammer')
    .sort((left, right) => {
      const leftAction = actions.get(left.id)!; const rightAction = actions.get(right.id)!;
      return actionEffectSpeed(right.id, rightAction, right, 'non_attack', players, actions)
        - actionEffectSpeed(left.id, leftAction, left, 'non_attack', players, actions)
        || left.id.localeCompare(right.id);
    });
  let nextRockfallRecovery = 0;
  const resolveRockfallRecoveriesBefore = (speed: number, actorId: string): void => {
    while (nextRockfallRecovery < pendingRockfallRecoveries.length) {
      const player = pendingRockfallRecoveries[nextRockfallRecovery]; const action = actions.get(player.id)!;
      const recoverySpeed = actionEffectSpeed(player.id, action, player, 'non_attack', players, actions);
      if (recoverySpeed < speed || (recoverySpeed === speed && player.id.localeCompare(actorId) > 0)) break;
      nextRockfallRecovery += 1;
      const before = player.currentHp;
      player.currentHp = Math.min(player.maxHp, player.currentHp + 1);
      performance[player.id].recoveryStates += player.currentHp - before;
      summary.push(`${player.nickname} 的岩崩锤恢复效果（速度 ${formatLevel(recoverySpeed)}）使其进入${healthStateName(player)}。`);
    }
  };
  const movedLotusIds = new Set<string>();
  let fastLotusMoved = false;
  let slowLotusMoved = false;
  for (const actor of ordered) {
    const submitted = actions.get(actor.id)!; const definition = requireAction(submitted.actionId); const effect = primaryEffect(submitted)!;
    const hadHellwalker = hasPassive(actor, 'hellwalker_passive');
    const speed = actionSpeed(actor.id, submitted, actor, players, actions);
    resolveRockfallRecoveriesBefore(speed, actor.id);
    if (!fastLotusMoved && speed <= 4) { moveLotusSeats(boardObjects, players, 4, movedLotusIds, summary); fastLotusMoved = true; }
    if (!slowLotusMoved && speed <= 1) { moveLotusSeats(boardObjects, players, 1, movedLotusIds, summary); slowLotusMoved = true; }
    if (!actor.alive || eliminated.has(actor.id) || (pendingWuyouRevives.has(actor) && actor.currentHp <= 0)) { processed.add(actor.id); continue; }
    if (canceledActors.has(actor.id)) { summary.push(`${actor.nickname} 的${definition.name}${canceledReasons.get(actor.id) ?? '被取消'}，未能结算。`); processed.add(actor.id); continue; }
    if (submitted.targetBoardObjectId) {
      resolveBoardObjectAttack(actor, submitted, definition, boardObjects, players, actions, blockers, immune, fragile, eliminated, darkShelterAbsorbs, summary, performance);
    } else if (effect === 'transform') {
      const previous = actor.characterId; const next = submitted.transformCharacterId ?? actor.characterId; const wasNearDeath = actor.maxHp > 1 && actor.currentHp === 1; if (previous === 'napoleon') removeBuff(actor, 'tactical_advantage'); actor.characterId = next; actor.currentFormId = 'base'; actor.maxHp = next === 'inner_guard' ? 3 : 2; actor.currentHp = wasNearDeath ? 1 : actor.maxHp; actor.commandBuffer = '';
      if (next === 'regent' && !actor.buffs?.has('regent_claimed')) { actor.resources.stars = resourceValue(actor, 'stars') + 3; setBuff(actor, 'regent_claimed'); summary.push(`${actor.nickname} 首次成为储君，获得 3 辉星。`); }
      if (next === 'ao') for (const player of players.values()) setBuff(player, 'cut_granted');
      summary.push(`${actor.nickname} 变身为${characterById.get(next ?? '')?.name ?? next}。`);
    } else if (effect === 'quick_attack') {
      const moved = tryMove(actor, submitted.targetGridIndex, players); setBuff(actor, 'quick_attack_ready'); summary.push(moved ? `${actor.nickname} 使用迅雷移动到 ${actor.gridIndex} 号地块。` : `${actor.nickname} 的迅雷没有产生位移。`);
    } else if (effect === 'charge') {
      if (!suppressedCharges.has(actor.id)) { gainResource(actor, 'energy', 1); summary.push(`${actor.nickname} 使用气，获得 1 气。`); }
      else summary.push(`${actor.nickname} 使用气，但本回合获得的 1 气被凹阻止。`);
    } else if (effect === 'gain_charge') {
      if (!absorbClaims.has(actor.id)) { gainResource(actor, 'charge', 1); summary.push(`${actor.nickname} 获得 1 蓄力。`); }
      else summary.push(`${actor.nickname} 使用蓄力，但产生的蓄力被吸走。`);
    } else if (['steal', 'double_steal'].includes(effect) && !hasChop) {
      if (hasPassive(actor, 'practice_makes_perfect') && buffStacks(actor, 'ao_mastery') >= 4) resolveAttackTargets(actor, submitted, definition, directTargets(actor, submitted, players), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
    } else if (effect === 'absorb_charge' && !hasCut) {
      const targetId = directTargets(actor, submitted, players)[0]; const target = players.get(targetId);
      if (buffStacks(actor, 'ao_mastery') >= 4 && targetId) resolveAttackTargets(actor, submitted, definition, [targetId], submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
    } else if (effect === 'heal') {
      const fire = Array.from(boardObjects.values()).find((object) => object.definitionId === 'nilu_fire' && object.gridIndex === submitted.targetGridIndex);
      if (fire) {
        boardObjects.delete(fire.objectId); fragile.delete(actor.id);
        const owner = players.get(fire.ownerPlayerId); if (owner) syncNiluResistance(owner);
        summary.push(`${actor.nickname} 熄灭了 ${owner?.nickname ?? fire.ownerPlayerId} 的尼卢火。`);
      }
      else { const before = actor.currentHp; actor.currentHp = Math.min(actor.maxHp, actor.currentHp + 1); performance[actor.id].recoveryStates += actor.currentHp - before; summary.push(`${actor.nickname} 使用治疗，进入${healthStateName(actor)}。`); }
    }
    else if (effect === 'breathing_method') { summonNiluFire(actor, submitted.targetGridIndex, players, summary); }
    else if (effect === 'five_precepts') { resolveFivePrecepts(actor, submitted, definition, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); }
    else if (effect === 'fire_purification') { resolveFirePurification(actor, definition, players, actions, blockers, immune, fragile, eliminated, darkShelterAbsorbs, summary, performance); }
    else if (effect === 'three_bodies') { summonLotusSeat(actor, submitted.targetGridIndex, players, summary); }
    else if (effect === 'soul_reap') {
      const target = players.get(directTargets(actor, submitted, players)[0]); const amount = target?.buffs?.has('resentment_mark') ? 2 : 1;
      gainResource(actor, 'soul', amount); if (target) applyDebuff(actor, target, 'soul_reap_debuff', 1, 3);
      summary.push(`${actor.nickname} 使用夺魂，获得 ${amount} 魂${target ? `，${target.nickname} 受到夺魂影响` : ''}。`);
    }
    else if (effect === 'soul_capture') {
      const selected = Array.from(actions.entries()).some(([id, candidate]) => id !== actor.id && requireAction(candidate.actionId).category === 'attack' && potentialTargets(players.get(id)!, candidate, players).includes(actor.id));
      gainResource(actor, 'soul', selected ? 2 : 1); summary.push(`${actor.nickname} 使用摄魄，获得 ${selected ? 2 : 1} 魂并免疫本回合攻击。`);
    }
    else if (effect === 'intimidate') {
      const targetId = directTargets(actor, submitted, players)[0]; const targetAction = actions.get(targetId);
      const level = resourceValue(actor, 'soul') + (targetAction && requireAction(targetAction.actionId).category === 'resource' ? resourcesAtSubmission.get(targetId) ?? 0 : 0);
      const credited = { ...performance[actor.id] };
      resolveAttackTargets(actor, submitted, definition, targetId ? [targetId] : [], level, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
      performance[actor.id] = credited;
    }
    else if (effect === 'deify') {
      const target = players.get(actionTargets(submitted)[0]); const threshold = submitted.power ?? 0;
      if (target && !target.buffs?.has('converted') && actionLevelAgainst(target, actions.get(target.id), actor.id, players) < threshold) {
        setBuff(target, 'converted', threshold); setBuff(target, 'conversion_threshold', threshold); target.buffSourcePlayerIds ??= {};
        target.buffSourcePlayerIds.converted = actor.id; target.buffSourcePlayerIds.conversion_threshold = actor.id;
        summary.push(`${actor.nickname} 的度神决成功，${target.nickname} 将从下一回合起受其操控。`);
      } else summary.push(`${actor.nickname} 的度神决未能度化目标。`);
    }
    else if (effect === 'bleed' || effect === 'blood_wall') {
      damagePlayer(actor, 0, 0, false, eliminated, true, true, submitted, false, actor.gridIndex);
      if (actor.alive && !eliminated.has(actor.id)) {
        if (effect === 'bleed') { gainResource(actor, 'energy', 2); summary.push(`${actor.nickname} 使用放血，获得 2 气并进入${healthStateName(actor)}。`); }
        else { setBuff(actor, 'armor', buffStacks(actor, 'armor') + 2.5); summary.push(`${actor.nickname} 筑起血墙，获得 2.5 级护甲并进入${healthStateName(actor)}。`); }
      } else summary.push(`${actor.nickname} 使用${definition.name}后死亡，未获得后续收益。`);
    }
    else if (effect === 'taunt') {
      const target = players.get(actionTargets(submitted)[0]);
      const applied = target ? applyDebuff(actor, target, 'vulnerability', buffStacks(target, 'vulnerability') + 2) : false;
      summary.push(!target ? `${actor.nickname} 的挑衅没有有效目标。` : applied ? `${actor.nickname} 挑衅 ${target.nickname}，施加 2 层易伤。` : `${target.nickname} 抵抗了 ${actor.nickname} 的挑衅易伤。`);
    }
    else if (effect === 'tremble') {
      const target = players.get(actionTargets(submitted)[0]);
      const applied = target ? applyDebuff(actor, target, 'vulnerability', buffStacks(target, 'vulnerability') + 4) : false;
      setBuff(actor, 'tremble_cooldown', 1, 2);
      summary.push(!target ? `${actor.nickname} 的战栗没有有效目标。` : applied ? `${actor.nickname} 令 ${target.nickname} 战栗，施加 4 层易伤。` : `${target.nickname} 抵抗了 ${actor.nickname} 的战栗易伤。`);
    }
    else if (effect === 'regain_spirit') {
      const armor = (submitted.power ?? 0) * 2;
      setBuff(actor, 'armor', buffStacks(actor, 'armor') + armor);
      setBuff(actor, 'regain_spirit_lock', 1, 3);
      summary.push(`${actor.nickname} 重振精神，获得 ${formatLevel(armor)} 级护甲；之后两回合只能攻击。`);
    }
    else if (effect === 'dominate') {
      const target = players.get(actionTargets(submitted)[0]);
      let applied = false;
      if (target) {
        applied = applyDebuff(actor, target, 'vulnerability', buffStacks(target, 'vulnerability') + 1);
        setBuff(actor, 'strength', buffStacks(actor, 'strength') + buffStacks(target, 'vulnerability'));
      }
      setBuff(actor, 'dominate_cooldown', 1, 2);
      summary.push(!target ? `${actor.nickname} 的主宰没有有效目标。` : applied ? `${actor.nickname} 主宰 ${target.nickname}，其易伤变为 ${formatLevel(buffStacks(target, 'vulnerability'))} 层。` : `${target.nickname} 抵抗了 ${actor.nickname} 的主宰易伤。`);
    }
    else if (effect === 'molten_fist') {
      const targetId = directTargets(actor, submitted, players)[0];
      resolveAttackTargets(actor, submitted, definition, targetId ? [targetId] : [], submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
      const target = players.get(targetId);
      if (target?.alive && target.buffs?.has('vulnerability')) {
        setBuff(target, 'vulnerability', buffStacks(target, 'vulnerability') * 2);
        summary.push(`${target.nickname} 的易伤延长至 ${formatLevel(buffStacks(target, 'vulnerability'))} 层。`);
      }
    }
    else if (effect === 'raise_axe') { setBuff(actor, 'axe_raised'); summary.push(`${actor.nickname} 举起战斧。`); }
    else if (effect === 'hidden_cache') { actor.resources.stars = resourceValue(actor, 'stars') + 1; setBuff(actor, 'hidden_cache_pending'); summary.push(`${actor.nickname} 获得 1 辉星，并将在下回合开始时再获得 3 辉星。`); }
    else if (effect === 'winning_hand') { actor.resources.stars = resourceValue(actor, 'stars') + 9; summary.push(`${actor.nickname} 获得 9 辉星。`); }
    else if (effect === 'forge_sword') summary.push(`${actor.nickname} 将君王之剑锻造至 ${formatLevel(forge(actor, 3))}。`);
    else if (effect === 'forge_wall') summary.push(`${actor.nickname} 将君王之剑锻造至 ${formatLevel(forge(actor, 1))}。`);
    else if (effect === 'summon_forth') { const level = forge(actor, 0.5); setBuff(actor, 'sovereign_blade_active'); summary.push(`${actor.nickname} 将君王之剑锻造至 ${formatLevel(level)} 并激活。`); }
    else if (effect === 'filthy_bloodline') summary.push(`${actor.nickname} 进入沉睡，无法被选中并免疫伤害。`);
    else if (effect === 'continue_sleep') { const remaining = Math.max(0, buffStacks(actor, 'sleeping') - 1); setBuff(actor, 'sleep_progress', buffStacks(actor, 'sleep_progress') + 1); if (remaining > 0) setBuff(actor, 'sleeping', remaining); else wakeMudrock(actor, false, summary); }
    else if (effect === 'harmony_with_light') { const uses = buffStacks(actor, 'harmony_uses') + 1; setBuff(actor, 'harmony_uses', uses); setBuff(actor, 'star_body', buffStacks(actor, 'star_body') + (actor.buffs?.has('transcendence') || actor.buffs?.has('transcendence_permanent') ? 1 : 0.5)); summary.push(`${actor.nickname} 的和光同尘提升至 ${formatLevel(uses)} 级，并积累神体。`); }
    else if (effect === 'create_star_core') { setBuff(actor, 'transcendence', 1, 4); setBuff(actor, 'transcendence_progress', 0); summary.push(`${actor.nickname} 进入超脱状态。`); }
    else if (effect === 'transcend_fuse') { removeBuff(actor, 'transcendence'); setBuff(actor, 'transcendence_permanent'); summary.push(`${actor.nickname} 将超脱融合为永久状态。`); }
    else if (effect === 'transcend_detonate') { resolveAttackTargets(actor, submitted, definition, directTargets(actor, submitted, players), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); removeBuff(actor, 'transcendence'); removeBuff(actor, 'transcendence_permanent'); removeBuff(actor, 'transcendence_progress'); }
    else if (effect === 'nebula_shock') { const targetId = directTargets(actor, submitted, players)[0]; resolveAttackTargets(actor, submitted, definition, targetId ? [targetId] : [], submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); const target = players.get(targetId); if (target?.alive) applyDebuff(actor, target, 'shock', 1, 2); }
    else if (effect === 'rule_the_world') {
      const covered = playersOnCells(actor, cellsAround(submitted.targetGridIndex ?? actor.gridIndex ?? 0, players.size * 2, 2), players);
      const dominionCells = new Set(Array.from(boardObjects.values()).filter((object) => object.definitionId === 'dominion' && object.ownerPlayerId === actor.id).map((object) => object.gridIndex));
      const affected: string[] = [];
      for (const targetId of covered) {
        const target = players.get(targetId); if (!target) continue;
        const attackLevel = dominionCells.has(target.gridIndex ?? -1) ? 4 : 3;
        if (attackLevel - actionLevelAgainst(target, actions.get(targetId), actor.id, players) < 0.5) continue;
        if (applyDebuff(actor, target, 'fear', 1, 2)) affected.push(target.nickname);
      }
      summary.push(affected.length ? `${actor.nickname} 的君临天下命中 ${affected.join('、')}，施加恐惧但不造成伤害。` : `${actor.nickname} 的君临天下没有命中任何玩家。`);
    }
    else if (effect === 'censure') { const targetId = directTargets(actor, submitted, players)[0]; const targetAction = actions.get(targetId); if (targetId && !processed.has(targetId) && targetAction && requireAction(targetAction.actionId).category === 'resource') { canceledActors.add(targetId); canceledReasons.set(targetId, '被杖责截断资源收益'); rewardTempered(actor, summary); } resolveAttackTargets(actor, submitted, definition, targetId ? [targetId] : [], submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); }
    else if (effect === 'see_through') { const targetId = directTargets(actor, submitted, players)[0]; const targetAction = actions.get(targetId); const success = Boolean(targetId && !processed.has(targetId) && targetAction && ['attack', 'special'].includes(requireAction(targetAction.actionId).category)); const level = success ? 0.5 + buffStacks(actor, 'tempered') : 0.5; if (success) { canceledActors.add(targetId); canceledReasons.set(targetId, '被看破取消'); blockers.delete(targetId); rewardTempered(actor, summary); } resolveAttackTargets(actor, submitted, definition, targetId ? [targetId] : [], level, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); }
    else if (effect === 'shatter') { const targetId = directTargets(actor, submitted, players)[0]; const targetAction = actions.get(targetId); const success = Boolean(targetAction && requireAction(targetAction.actionId).category === 'defense'); const mastery = buffStacks(actor, 'tempered'); const level = 1 + mastery + (success ? mastery * 0.5 : 0); if (success) { const target = players.get(targetId); if (target) applyDebuff(actor, target, 'defense_forbidden', 1, 2); rewardTempered(actor, summary); } resolveAttackTargets(actor, submitted, definition, targetId ? [targetId] : [], level, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); }
    else if (effect === 'collapsing_fear') resolveCollapsingFear(actor, submitted, definition, players, boardObjects, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
    else if (['attack_order', 'defense_order', 'tactical_order'].includes(effect)) { const command = effect === 'attack_order' ? 'A' : effect === 'defense_order' ? 'D' : 'T'; actor.commandBuffer = `${actor.commandBuffer ?? ''}${command}`.slice(-6); if (effect === 'attack_order') resolveAttackTargets(actor, submitted, definition, directTargets(actor, submitted, players), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); summary.push(`${actor.nickname} 的指令缓冲为 ${actor.commandBuffer}。`); }
    else if (effect === 'napoleon_strategy') resolveNapoleonStrategy(actor, submitted, definition, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
    else if (effect === 'shadow_blade') { resolveSpatialAttack(actor, submitted, definition, cellsAround(actor.gridIndex ?? 0, players.size * 2, 1), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); setBuff(actor, 'shadow_blade_cooldown', 4); }
    else if (effect === 'ten_volt' || effect === 'hundred_thousand_volt') { const targets = firstPlayersInBothDirections(actor, players); resolveAttackTargets(actor, submitted, definition, targets, submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); if (effect === 'ten_volt') removeBuff(actor, 'quick_attack_ready'); }
    else if (effect === 'dream_path') {
      const start = actor.gridIndex ?? 0; const endpoint = submitted.targetGridIndices?.[0] ?? start;
      const cells = directedPathCells(start, endpoint, players.size * 2, submitted.pathDirection ?? 1);
      resolveSpatialAttack(actor, submitted, definition, cells, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
      layDreamPath(actor, cells, summary);
    }
    else if (effect === 'rockfall_hammer') { resolveSpatialAttack(actor, submitted, definition, cellsAround(actor.gridIndex ?? 0, players.size * 2, 2), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); setBuff(actor, 'hammer_ready', Math.max(0, buffStacks(actor, 'hammer_ready') - 1)); }
    else if (effect === 'haunting_shadows') { for (const player of players.values()) if (player.id !== actor.id) applyDebuff(actor, player, 'darkness', 1, 2); setBuff(actor, 'nightmare_dash_ready', 1, 2); if (actionTargets(submitted).length) { resolveAttackTargets(actor, submitted, definition, actionTargets(submitted), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); finishNightmareDash(actor, players.get(actionTargets(submitted)[0]), players); } summary.push(`${actor.nickname} 令其他玩家陷入黑暗。`); }
    else if (effect === 'nightmare_dash') { resolveAttackTargets(actor, submitted, definition, actionTargets(submitted), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); finishNightmareDash(actor, players.get(actionTargets(submitted)[0]), players); }
    else if (effect === 'silent_fear') {
      const targetId = actionTargets(submitted)[0]; const target = players.get(targetId); const targetAction = actions.get(targetId);
      if (target && actionLevelAgainst(target, targetAction, actor.id, players) <= submittedActionLevel(actor, submitted)) { const applied = applyDebuff(actor, target, 'fear', 1, 2); if (applied && !processed.has(targetId) && targetAction?.actionId !== 'charge') { canceledActors.add(targetId); canceledReasons.set(targetId, '因无言恐惧失效'); blockers.delete(targetId); setBuff(target, 'fear_action_canceled'); } }
      summary.push(target ? `${actor.nickname} 的无言恐惧笼罩 ${target.nickname}，但不造成伤害。` : `${actor.nickname} 的无言恐惧没有有效目标。`);
    } else if (isDirectAttack(effect)) resolveAttackTargets(actor, submitted, definition, directTargets(actor, submitted, players), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);

    if (preclaimedResources.has(actor.id) && hasPassive(actor, 'practice_makes_perfect')) setBuff(actor, 'ao_mastery', Math.min(4, buffStacks(actor, 'ao_mastery') + 1));
    if (actor.characterId === 'quilon' && definition.category === 'attack' && !['fire_purification', 'five_precepts'].includes(effect)) {
      triggerNiluFires(actor, definition, actor.buffs?.has('bodhisattva_debate') && ['fist', 'slash'].includes(effect) ? 2 : 1, players, actions, blockers, immune, fragile, eliminated, darkShelterAbsorbs, summary, performance);
    }
    if (effect === 'aoao_divine') removeBuff(actor, 'ao_mastery');
    if (effect === 'sovereign_blade') removeBuff(actor, 'sovereign_blade_active');
    if (hasPassive(actor, 'child_of_earth') && effect === 'fist') setBuff(actor, 'mud_fist_level', buffStacks(actor, 'mud_fist_level') + 1);
    if (definition.cooldownReduction && actor.buffs?.has(definition.cooldownReduction.buffId)) {
      const next = buffStacks(actor, definition.cooldownReduction.buffId) - definition.cooldownReduction.stacks;
      if (next > 0) setBuff(actor, definition.cooldownReduction.buffId, next); else removeBuff(actor, definition.cooldownReduction.buffId);
    }
    if (hadHellwalker && definition.category !== 'base' && !actionCanDealAttackDamage(actor, submitted)) applyHellwalker(actor, players.get(actionTargets(submitted)[0] ?? '') ?? actor, players, summary);
    processed.add(actor.id);
  }
  if (!fastLotusMoved) moveLotusSeats(boardObjects, players, 4, movedLotusIds, summary);
  if (!slowLotusMoved) moveLotusSeats(boardObjects, players, 1, movedLotusIds, summary);

  for (const player of aliveAtStart) {
    const effect = primaryEffect(actions.get(player.id));
    if (effect === 'collect_light' && canceledAttackTargets.has(player.id) && player.currentHp === hpAtStart.get(player.id) && !eliminated.has(player.id)) { player.resources.stars = resourceValue(player, 'stars') + 1; summary.push(`${player.nickname} 的收集光辉获得 1 辉星。`); }
    removeBuff(player, 'iridescence_afterglow'); if (effect === 'iridescence') setBuff(player, 'iridescence_afterglow');
    if (hasPassive(player, 'fertile_soil') && !player.buffs?.has('mud_barrier')) { const count = buffStacks(player, 'mud_round_counter') + (effect === 'transform' ? 0 : 1); if (count >= 4) { setBuff(player, 'mud_barrier'); setBuff(player, 'mud_round_counter', 0); summary.push(`${player.nickname} 的沃土予身生成一层屏障。`); } else setBuff(player, 'mud_round_counter', count); }
    if (effect === 'dark_shelter' && darkShelterAbsorbs.has(player.id)) { setBuff(player, 'dark_shelter_power', 1, 4); summary.push(`${player.nickname} 的黑暗庇护成功吸收攻击。`); }
    removeBuff(player, 'fear_action_canceled');
    if (effect === 'dream_path') tryMove(player, actions.get(player.id)?.targetGridIndex, players);
    if (player.buffs?.has('shock') && actions.get(player.id) && requireAction(actions.get(player.id)!.actionId).category === 'attack' && player.alive) { damagePlayer(player, 0, 0, false, eliminated, true, true, actions.get(player.id), false, player.gridIndex); summary.push(`${player.nickname} 因震荡使用攻击，进入${healthStateName(player)}。`); }
    if (player.buffs?.has('transcendence') || player.buffs?.has('transcendence_permanent')) {
      const before = player.currentHp;
      player.currentHp = Math.min(player.maxHp, player.currentHp + 1);
      performance[player.id].recoveryStates += player.currentHp - before;
      setBuff(player, 'star_body', buffStacks(player, 'star_body') + 0.5);
      setBuff(player, 'transcendence_progress', buffStacks(player, 'transcendence_progress') + 1);
    }
    resolveNapoleonCounter(player, actions.get(player.id), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
    if (convertedAtStart.has(player.id) && player.buffs?.has('converted')) {
      const action = actions.get(player.id); const threshold = buffStacks(player, 'conversion_threshold');
      const remaining = buffStacks(player, 'converted') - (action ? convertedActionCost(player, action, threshold) : 0);
      if (remaining <= 0) { removeBuff(player, 'converted'); removeBuff(player, 'conversion_threshold'); summary.push(`${player.nickname} 已完成度化所需的累计行动消耗，恢复自主。`); }
      else setBuff(player, 'converted', remaining);
    }
    if (player.buffs?.has('vulnerability')) setBuff(player, 'vulnerability', buffStacks(player, 'vulnerability') - 1);
    removeBuff(player, 'redirect_triggered');
  }
  resolvePendingWuyouRevives(players, eliminated, summary);
  for (const id of eliminated) { const player = players.get(id); if (player) { player.alive = false; player.currentHp = 0; } }
  removeQuilonObjectsForDeadOwners(boardObjects, players, summary);
  tickBoardObjects(boardObjects);
  for (const player of players.values()) roundDamageStates.delete(player);
  const learningTargets = aliveAtStart.flatMap((player) => Array.from(roundLearningTargets.get(player) ?? [], (targetPlayerId) => ({ learnerPlayerId: player.id, targetPlayerId })));
  return { summary, eliminated: Array.from(eliminated), steps: buildResolutionSteps(actions, players), performance, learningTargets };
}

function resolveGlobalCounter(effectIds: readonly EffectHandlerId[], targetName: string, counterName: string, counterEffect: EffectHandlerId, players: CombatPlayer[], actions: ReadonlyMap<string, SubmittedAction>, eliminated: Set<string>, summary: string[], fragile = new Set<string>()): void {
  const effects = new Set(effectIds);
  const users = players.filter((player) => effects.has(primaryEffect(actions.get(player.id))!));
  const source = players.filter((player) => primaryEffect(actions.get(player.id)) === counterEffect).sort((left, right) => left.id.localeCompare(right.id))[0];
  for (const user of users) { const hpBefore = user.currentHp; const outcome = damagePlayer(user, 1, 0, fragile.has(user.id), eliminated, true, true, actions.get(user.id), false, source?.gridIndex); if (source && user.currentHp < hpBefore) { rewardDevour(source, actions.get(source.id), summary); if ((outcome === 'eliminated' || outcome === 'shifted_out') && hasPassive(source, 'devour_heaven')) roundLearningTargets.get(source)?.add(user.id); } summary.push(`${user.nickname} 的${targetName}被${counterName}取消，进入${healthStateName(user)}。`); }
  if (!users.length) summary.push(`有人使用${counterName}，但本回合无人使用${targetName}。`);
}

function resolveNapoleonStrategy(actor: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const sequence = definition.napoleonSequence!; const direct = directTargets(actor, submitted, players); const levelBefore = submittedActionLevel(actor, submitted);
  const directAttack = ['AA', 'AD', 'AT', 'TA', 'AAA', 'AAT', 'TAA', 'TAD', 'TTA', 'AADD', 'TATA'].includes(sequence);
  if (directAttack) {
    const target = players.get(direct[0]); const hpBefore = target?.currentHp;
    const tactical = buffStacks(actor, 'tactical_advantage');
    const level = sequence === 'TTA' ? levelBefore + tactical * 0.5 : levelBefore;
    resolveAttackTargets(actor, submitted, definition, direct, level, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
    if (sequence === 'AAT' && target && hpBefore !== undefined && target.currentHp < hpBefore) setBuff(actor, 'napoleon_speed', 2, 2);
    if (['AT', 'TAD'].includes(sequence) && target?.alive) applyDebuff(actor, target, 'calibrated', 1, 2);
    if (sequence === 'TATA' && target?.alive) { applyDebuff(actor, target, 'attack_forbidden', 1, 2); setBuff(actor, 'napoleon_speed', 2, 2); }
    if (['TTA', 'TTAA'].includes(sequence)) removeBuff(actor, 'tactical_advantage');
  } else if (sequence === 'ATA' || sequence === 'AAAA') {
    const radius = sequence === 'ATA' ? 1 : 2; const targets = playersOnCells(actor, cellsAround(actor.gridIndex ?? 0, players.size * 2, radius), players);
    resolveAttackTargets(actor, submitted, definition, targets, levelBefore, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
    if (sequence === 'ATA') for (const targetId of targets) { const target = players.get(targetId); if (target?.alive) applyDebuff(actor, target, 'swayed', 1, 2); }
  } else if (sequence === 'AAAAA') {
    resolveAttackTargets(actor, submitted, definition, Array.from(players.values()).filter((target) => target.id !== actor.id && target.alive).map((target) => target.id), levelBefore, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
  } else if (sequence === 'TTAA') {
    const target = players.get(direct[0]);
    const targets = target ? playersOnCells(actor, cellsAround(target.gridIndex ?? 0, players.size * 2, 2), players) : [];
    const tactical = buffStacks(actor, 'tactical_advantage');
    resolveAttackTargets(actor, submitted, definition, targets, levelBefore + tactical * 0.5, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
    removeBuff(actor, 'tactical_advantage');
  }
  if (sequence === 'AT') addTacticalAdvantage(actor, 1, 2);
  if (sequence === 'DT') { setBuff(actor, 'defense_deployment', 1, 2); addTacticalAdvantage(actor, 1, 2); }
  if (sequence === 'TT') addTacticalAdvantage(actor, 2, 2);
  if (sequence === 'TTT') addTacticalAdvantage(actor, 3, 2);
  if (sequence === 'TTTT') { addTacticalAdvantage(actor, 4, 3); setBuff(actor, 'napoleon_divine', Math.min(3, buffStacks(actor, 'napoleon_divine') + 1)); }
  if (sequence === 'DDDDD') setBuff(actor, 'unfallen_fortress', 1, 4);
  if (sequence === 'TTTTT') { addTacticalAdvantage(actor, 5, 4); setBuff(actor, 'napoleon_emperor', 1, 6); }
  if (sequence === 'TATAT') { setBuff(actor, 'elba_unlocked'); setBuff(actor, 'hundred_days'); }
  summary.push(`${actor.nickname} 执行「${definition.name}」，剩余指令缓冲为 ${actor.commandBuffer || '空'}。`);
}

function resolveNapoleonCounter(actor: CombatPlayer, submitted: SubmittedAction | undefined, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const sequence = submitted && requireAction(submitted.actionId).napoleonSequence;
  if (!actor.alive || !submitted || !['DA', 'DAD', 'DDT'].includes(sequence ?? '') || !canceled.has(actor.id)) return;
  if (sequence === 'DDT') { setBuff(actor, 'napoleon_speed', 1, 2); return; }
  const defense = submittedDefenseLevel(actor, submitted, requireAction(submitted.actionId));
  const incoming = Array.from(actions.entries()).filter(([attackerId, action]) => {
    const attacker = players.get(attackerId); if (!attacker?.alive || attackerId === actor.id || !actionCanDealAttackDamage(attacker, action) || !potentialTargets(attacker, action, players).includes(actor.id)) return false;
    return adjustedAttackLevel(attacker, actor, action) - defense < 0.5;
  }).sort(([leftId, left], [rightId, right]) => adjustedAttackLevel(players.get(rightId)!, actor, right) - adjustedAttackLevel(players.get(leftId)!, actor, left));
  const targetId = incoming[0]?.[0]; if (!targetId) return;
  const level = 1.5 + buffStacks(actor, 'tactical_advantage') * 0.5;
  const hpBefore = players.get(targetId)?.currentHp;
  resolveAttackTargets(actor, submitted, requireAction(submitted.actionId), [targetId], level, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
  const target = players.get(targetId); if (sequence === 'DAD' && target?.alive && hpBefore !== undefined && target.currentHp < hpBefore) applyDebuff(actor, target, 'swayed', 1, 2);
}

function adjustedAttackLevel(attacker: CombatPlayer, target: CombatPlayer, action: SubmittedAction): number {
  let level = submittedDamageLevel(attacker, action) + (target.buffs?.has('fear') ? 1 : 0) + (target.buffs?.has('calibrated') ? 1 : 0);
  if (target.buffs?.has('defense_deployment')) level = Math.max(0, level - 1);
  if (attacker.buffs?.has('dark_shelter_power')) level += 0.5;
  if (hasDreamPathBonus(attacker)) level += 0.5;
  return level;
}

function resolveSpatialAttack(attacker: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, cells: number[], players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const targets = Array.from(players.values()).filter((target) => target.id !== attacker.id && target.alive && cells.includes(target.gridIndex ?? -1)).map((target) => target.id);
  resolveAttackTargets(attacker, submitted, definition, targets, submittedActionLevel(attacker, submitted), players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
}

function resolveAttackTargets(attacker: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, targets: string[], level: number, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  if (definition.multiHit || definition.repeatAttack) {
    const skillLevelPerHit = definition.repeatAttack ? level : multiHitSkillLevel(definition);
    const damageLevelPerHit = definition.repeatAttack ? submittedDamageLevel(attacker, submitted) : multiHitDamageLevel(definition);
    const allocations = new Map<string, number>();
    for (const originalTargetId of targets) {
      const targetId = definition.repeatAttack ? redirectAttackTarget(attacker, originalTargetId, players, actions, summary) : originalTargetId;
      allocations.set(targetId, (allocations.get(targetId) ?? 0) + 1);
    }
    for (const [targetId, allocationsForTarget] of allocations) {
      attempts.add(targetId);
      const target = players.get(targetId);
      const hitCount = allocationsForTarget * repeatHitCount(attacker, target, definition);
      const targetAction = actions.get(targetId);
      if (target && targetAction && requireAction(targetAction.actionId).category === 'attack'
        && actionAppliesAgainst(target, targetAction, attacker.id, players)) {
        summary.push(`${attacker.nickname} 的${definition.name}对 ${target?.nickname ?? targetId} 合并 ${hitCount} 段技能等级；合并后的技能等级为 ${formatLevel(hitCount * skillLevelPerHit)}；单段伤害等级为 ${formatLevel(damageLevelPerHit)}。`);
        if (applyAttack(attacker, target, definition, hitCount * skillLevelPerHit, players, actions, blockers, immune, fragile, eliminated, shelter, players.size * 2, summary, performance, damageLevelPerHit) === 'none') canceled.add(targetId);
        continue;
      }
      for (let hit = 1; hit <= hitCount && target?.alive && !eliminated.has(targetId); hit += 1) {
        if (hitCount > 1) summary.push(`${attacker.nickname} 的${definition.name}对 ${target.nickname} 结算第 ${hit}/${hitCount} 段。`);
        if (applyAttack(attacker, target, definition, skillLevelPerHit, players, actions, blockers, immune, fragile, eliminated, shelter, players.size * 2, summary, performance, damageLevelPerHit) === 'none') canceled.add(targetId);
      }
    }
    return;
  }
  for (const originalTargetId of new Set(targets)) {
    const targetId = redirectAttackTarget(attacker, originalTargetId, players, actions, summary);
    attempts.add(targetId);
    const explicitDamageLevel = hasPassive(attacker, 'tear_passive') && definition.category === 'attack'
      ? submittedDamageLevel(attacker, submitted)
      : undefined;
    if (applyAttack(attacker, players.get(targetId), definition, level, players, actions, blockers, immune, fragile, eliminated, shelter, players.size * 2, summary, performance, explicitDamageLevel) === 'none') canceled.add(targetId);
  }
}

function validateDreamPathSelection(player: CombatPlayer, target: CombatPlayer | undefined, destination: number | undefined, direction: -1 | 1 | undefined, cellCount: number): void {
  if (!target || (direction !== -1 && direction !== 1)) throw new Error('请选择魇之梦径的顺时针或逆时针方向');
  if (!Number.isInteger(destination) || !directedPathCells(player.gridIndex ?? 0, target.gridIndex ?? 0, cellCount, direction).includes(destination!)) {
    throw new Error('请选择魇之梦径路径内的移动地块');
  }
}

function applyAttack(attacker: CombatPlayer, target: CombatPlayer | undefined, attack: ActionDefinition, rawLevel: number, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, shelter: Map<string, string>, _boardCellCount: number, summary: string[], performance: Record<string, RoundPerformance>, explicitDamageLevel?: number): DamageOutcome {
  if (!target || target.id === attacker.id) return 'none';
  if (target.buffs?.has('sleeping')) { summary.push(`${target.nickname} 在沉睡中免疫了 ${attacker.nickname} 的${attack.name}。`); return 'none'; }
  const trueDamage = attack.damageType === 'true';
  const piercingDamage = attack.damageType === 'piercing';
  const attackerAction = actions.get(attacker.id);
  const targetAction = actions.get(target.id); const targetDefinition = targetAction ? requireAction(targetAction.actionId) : undefined;
  const attackSpeed = attackerAction ? actionEffectSpeed(attacker.id, attackerAction, attacker, 'attack', players, actions) : 0;
  const defenseKeepsUp = Boolean(targetAction
    && actionEffectSpeed(target.id, targetAction, target, 'defense', players, actions) >= attackSpeed);
  if (target.buffs?.has('unbroken') || immune.has(target.id)) { performance[target.id].successfulDefenses += 1; const immuneName = primaryEffect(targetAction) === 'soul_capture' ? '摄魄' : '超防'; summary.push(`${target.nickname} 的${target.buffs?.has('unbroken') ? '不破' : immuneName}挡住了 ${attacker.nickname}。`); return 'none'; }
  if (shelter.get(target.id) === attacker.id && defenseKeepsUp) { performance[target.id].successfulDefenses += 1; summary.push(`${target.nickname} 的黑暗庇护吸收了 ${attacker.nickname} 的${attack.name}。`); return 'none'; }
  let attackerLevel = rawLevel + (target.buffs?.has('fear') ? 1 : 0);
  let damageLevel = (explicitDamageLevel ?? attack.damageLevel ?? rawLevel) + (target.buffs?.has('fear') ? 1 : 0);
  if (target.buffs?.has('calibrated')) { attackerLevel += 1; damageLevel += 1; }
  if (target.buffs?.has('defense_deployment')) { attackerLevel = Math.max(0, attackerLevel - 1); damageLevel = Math.max(0, damageLevel - 1); }
  if (attacker.buffs?.has('dark_shelter_power')) { attackerLevel += 0.5; damageLevel += 0.5; }
  if (hasDreamPathBonus(attacker)) { attackerLevel += 0.5; damageLevel += 0.5; }
  if (attack.id !== 'bully' && target.buffs?.has('vulnerability')) damageLevel += 0.5;
  const sourceDamageLevel = damageLevel;
  const block = piercingDamage ? undefined : blockers.get(target.id);
  const equalDamageAttack = Boolean(attackerAction && targetAction && targetDefinition?.category === 'attack'
    && actionAppliesAgainst(target, targetAction, attacker.id, players)
    && Math.abs((explicitDamageLevel ?? submittedDamageLevel(attacker, attackerAction)) - submittedDamageLevel(target, targetAction)) < 1e-6);
  const speedAllowsOpposition = equalDamageAttack || Boolean(attackerAction && targetAction
    && actionEffectSpeed(target.id, targetAction, target, 'attack', players, actions)
      >= attackSpeed);
  const opposingSkillLevel = attack.id !== 'dissipation' && targetDefinition?.category !== 'defense' && speedAllowsOpposition ? actionLevelAgainst(target, targetAction, attacker.id, players) : 0;
  if (opposingSkillLevel > 0) {
    const skillDifference = attackerLevel - opposingSkillLevel;
    if (skillDifference < 0.5) { summary.push(`${attacker.nickname} 的${attack.name}（技能 ${formatLevel(attackerLevel)}）未胜过 ${target.nickname} 的${targetDefinition!.name}（技能 ${formatLevel(opposingSkillLevel)}）。`); return 'none'; }
    damageLevel = Math.min(damageLevel, skillDifference);
  }
  if (!trueDamage) damageLevel = Math.max(0, damageLevel - buffStacks(target, 'star_body'));
  let targetLevel = block && targetAction && defenseKeepsUp ? submittedDefenseLevel(target, targetAction, block) : 0;
  if (!piercingDamage && target.buffs?.has('unfallen_fortress')) targetLevel = Math.max(targetLevel, 1);
  if (targetAction && requireAction(targetAction.actionId).category === 'defense' && !block) targetLevel = 0;
  if (primaryEffect(targetAction) === 'dark_shelter') targetLevel = 0;
  if (block && damageLevel < targetLevel) { performance[target.id].successfulDefenses += 1; if (hasPassive(target, 'tempered_passive')) rewardTempered(target, summary); summary.push(`${target.nickname} 的${block.name}抵消了 ${attacker.nickname} 的${attack.name}。`); return 'none'; }
  if (block?.defenseBreak && targetLevel > 0 && damageLevel >= targetLevel) {
    blockers.delete(target.id);
    if (block.defenseBreak.mode === 'persistent') setBuff(target, block.defenseBreak.brokenBuffId!);
    if (block.effects[0]?.handler === 'axe_defend') gainResource(target, 'energy', 1);
    summary.push(block.defenseBreak.mode === 'persistent'
      ? `${target.nickname} 的${block.name}被击碎，之后防御等级降为 0。`
      : `${target.nickname} 的${block.name}被击碎，本次生成的防御等级降为 0。`);
  }
  const hpBefore = target.currentHp;
  let effectiveDamageLevel = Math.max(0, damageLevel - targetLevel);
  if (!trueDamage && !piercingDamage && effectiveDamageLevel > 0) {
    const armorBefore = buffStacks(target, 'armor');
    const absorbed = Math.min(armorBefore, effectiveDamageLevel);
    if (absorbed > 0) {
      setBuff(target, 'armor', armorBefore - absorbed);
      effectiveDamageLevel -= absorbed;
      summary.push(`${target.nickname} 的护甲抵消了 ${formatLevel(absorbed)} 级伤害，剩余 ${formatLevel(buffStacks(target, 'armor'))} 级护甲。`);
    }
  }
  if (effectiveDamageLevel > 0 && target.buffs?.has('mud_barrier') && targetDefinition?.category !== 'defense') { const before = target.currentHp; removeBuff(target, 'mud_barrier'); target.currentHp = Math.min(target.maxHp, target.currentHp + 1); performance[target.id].successfulDefenses += 1; performance[target.id].recoveryStates += target.currentHp - before; summary.push(`${target.nickname} 的屏障抵消攻击并使其进入${healthStateName(target)}。`); return 'none'; }
  const damageSourceGrid = attack.id === 'dissipation' ? target.gridIndex : attacker.gridIndex;
  const outcome = damagePlayer(target, effectiveDamageLevel, 0, fragile.has(target.id), eliminated, false, sourceDamageLevel < 3, targetAction, sourceDamageLevel >= 3 && effectiveDamageLevel >= 1, damageSourceGrid);
  if (outcome === 'none') performance[target.id].successfulDefenses += 1;
  else {
    const appliedStates = Math.max(0, hpBefore - target.currentHp);
    performance[attacker.id].damageStatesDealt += appliedStates;
    if (appliedStates > 0 && (outcome === 'eliminated' || outcome === 'shifted_out')) {
      performance[attacker.id].eliminations += 1;
      if (hasPassive(attacker, 'devour_heaven')) roundLearningTargets.get(attacker)?.add(target.id);
    }
  }
  if (outcome === 'none' && block && hasPassive(target, 'tempered_passive')) rewardTempered(target, summary);
  if (target.currentHp < hpBefore) rewardDevour(attacker, actions.get(attacker.id), summary);
  const comparison = `${attacker.nickname} 的${attack.name}（技能 ${formatLevel(attackerLevel)} / 伤害 ${formatLevel(damageLevel)}）对 ${target.nickname} 的${targetAction ? requireAction(targetAction.actionId).name : '无招式'}`;
  if (outcome === 'none') summary.push(`${comparison}：有效伤害不足 0.5，未造成伤害。`);
  else summary.push(`${comparison}：有效伤害 ${formatLevel(effectiveDamageLevel)}，${target.nickname} 进入${healthStateName(target)}。`);
  return outcome;
}

type DamageOutcome = 'none' | 'shifted' | 'shifted_out' | 'eliminated';
function damagePlayer(player: CombatPlayer, attackLevel: number, defenseLevel: number, isFragile: boolean, eliminated: Set<string>, forceShift = false, maxOneState = false, selected?: SubmittedAction, lethalHeavyHit = false, sourceGridIndex?: number): DamageOutcome {
  if (roundDamageImmunePlayers.get(player)?.has(player.id)) return 'none';
  const difference = Math.max(0, attackLevel - niluFireMitigation(player)) - defenseLevel;
  if (forceShift) {
    if (player.characterId === 'inner_guard') return applyInnerGuardLoss(player, player.currentHp, 1, eliminated, sourceGridIndex);
    const hpBeforeDamage = player.currentHp;
    const finishDirect = (outcome: DamageOutcome): DamageOutcome => { recordWarriorHealthShift(player, hpBeforeDamage); clearArmorOnDeath(player); return outcome; };
    if (isFragile) { player.currentHp = 0; if (consumeDeathRevive(player, hpBeforeDamage)) return finishDirect('shifted'); removeOwnedQuilonObjectsImmediately(player); eliminated.add(player.id); return finishDirect('eliminated'); }
    player.currentHp -= 1;
    if (player.currentHp <= 0) { if (consumeDeathRevive(player, hpBeforeDamage)) return finishDirect('shifted'); removeOwnedQuilonObjectsImmediately(player); eliminated.add(player.id); return finishDirect('shifted_out'); }
    if (player.characterId !== 'napoleon') gainResource(player, 'energy', 1);
    return finishDirect('shifted');
  }
  const receivedLevel = difference;
  const previous = roundDamageStates.get(player);
  if (previous && receivedLevel <= previous.highestLevel + 1e-6 && (!lethalHeavyHit || previous.lethalHeavyHit)) return previous.outcome;
  if (previous) {
    removeCreatedDominions(player, previous.createdDominionIds);
    player.currentHp = previous.startingHp; player.alive = true; eliminated.delete(player.id);
    removeBuff(player, 'transcendence'); removeBuff(player, 'transcendence_permanent'); removeBuff(player, 'transcendence_progress');
    removeBuff(player, 'wuyou_used'); removeBuff(player, 'bodhisattva_debate');
    if (previous.transcendence === 'temporary') setBuff(player, 'transcendence', 1, previous.transcendenceRemainingTurns);
    if (previous.transcendence === 'permanent') setBuff(player, 'transcendence_permanent');
    if (previous.transcendenceProgress > 0) setBuff(player, 'transcendence_progress', previous.transcendenceProgress);
    if (previous.wuyouUsedBefore) setBuff(player, 'wuyou_used');
    if (previous.bodhisattvaBefore) setBuff(player, 'bodhisattva_debate');
    setBuff(player, 'strength', previous.strengthBefore);
    setBuff(player, 'shred_count', previous.shredCountBefore);
  }
  const state: RoundDamageState = previous ?? {
    startingHp: player.currentHp,
    highestLevel: -Infinity,
    lethalHeavyHit: false,
    outcome: 'none',
    grantedEnergy: false,
    transcendence: player.buffs?.has('transcendence') ? 'temporary' : player.buffs?.has('transcendence_permanent') ? 'permanent' : undefined,
    transcendenceProgress: buffStacks(player, 'transcendence_progress'),
    transcendenceRemainingTurns: player.buffRemainingTurns?.transcendence,
    createdDominionIds: [],
    wuyouUsedBefore: player.buffs?.has('wuyou_used') === true,
    bodhisattvaBefore: player.buffs?.has('bodhisattva_debate') === true,
    strengthBefore: buffStacks(player, 'strength'),
    shredCountBefore: buffStacks(player, 'shred_count'),
  };
  state.highestLevel = receivedLevel;
  state.lethalHeavyHit ||= lethalHeavyHit;
  const finish = (outcome: DamageOutcome): DamageOutcome => { recordWarriorHealthShift(player, state.startingHp); clearArmorOnDeath(player); state.outcome = outcome; roundDamageStates.set(player, state); return outcome; };
  const mudFistRisk = player.characterId === 'mudrock' && selected?.actionId === 'fist' && difference >= 0.5;
  if (player.characterId === 'inner_guard') {
    const requestedLoss = isFragile && difference >= 0.5 ? state.startingHp : !maxOneState && difference >= 0.5 ? 2 : difference >= 0.5 ? 1 : 0;
    if (requestedLoss === 0) return finish('none');
    return finish(applyInnerGuardLoss(player, state.startingHp, requestedLoss, eliminated, sourceGridIndex, state));
  }
  if ((isFragile && (forceShift || difference >= 0.5)) || mudFistRisk) { player.currentHp = 0; if (consumeDeathRevive(player, state.startingHp)) return finish('shifted'); removeOwnedQuilonObjectsImmediately(player); eliminated.add(player.id); return finish('eliminated'); }
  if (state.lethalHeavyHit || (!maxOneState && difference >= 3)) { player.currentHp = 0; if (consumeDeathRevive(player, state.startingHp)) return finish('shifted'); removeOwnedQuilonObjectsImmediately(player); eliminated.add(player.id); return finish('eliminated'); }
  if (forceShift || difference >= 0.5) { player.currentHp -= 1; if (player.currentHp <= 0) { if (consumeDeathRevive(player, state.startingHp)) return finish('shifted'); removeOwnedQuilonObjectsImmediately(player); eliminated.add(player.id); return finish('shifted_out'); } if (player.characterId !== 'napoleon' && !state.grantedEnergy) { gainResource(player, 'energy', 1); state.grantedEnergy = true; } return finish('shifted'); }
  return finish('none');
}

function countMudrockSelections(players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>): void {
  for (const [actorId, action] of actions) for (const targetId of actionTargets(action)) {
    const target = players.get(targetId); if (!target || target.id === actorId || target.characterId !== 'mudrock') continue;
    let count = buffStacks(target, 'hammer_counter') + 1; if (count >= 3) { count -= 3; setBuff(target, 'hammer_ready', buffStacks(target, 'hammer_ready') + 1); } setBuff(target, 'hammer_counter', count);
  }
}

function chooseDarkShelterAbsorbs(players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>): Map<string, string> {
  const result = new Map<string, string>();
  for (const target of players.values()) {
    if (primaryEffect(actions.get(target.id)) !== 'dark_shelter') continue;
    const incoming = Array.from(actions.entries()).filter(([id, action]) => id !== target.id && actionCanDealAttackDamage(players.get(id)!, action) && potentialTargets(players.get(id)!, action, players).includes(target.id))
      .sort(([leftId, left], [rightId, right]) => submittedDamageLevel(players.get(rightId)!, right) - submittedDamageLevel(players.get(leftId)!, left));
    if (incoming[0]) result.set(target.id, incoming[0][0]);
  }
  return result;
}

function potentialTargets(actor: CombatPlayer, action: SubmittedAction, players: Map<string, CombatPlayer>): string[] {
  const effect = primaryEffect(action); const count = players.size * 2;
  if (effect === 'ten_volt' || effect === 'hundred_thousand_volt') return firstPlayersInBothDirections(actor, players);
  if (effect === 'shadow_blade') return playersOnCells(actor, cellsAround(actor.gridIndex ?? 0, count, 1), players);
  if (effect === 'rockfall_hammer') return playersOnCells(actor, cellsAround(actor.gridIndex ?? 0, count, 2), players);
  if (effect === 'collapsing_fear') {
    const dominionCells = new Set(Array.from(roundBoardObjects.get(actor)?.values() ?? []).filter((object) => object.definitionId === 'dominion' && object.ownerPlayerId === actor.id).map((object) => object.gridIndex));
    const sideTargets = firstPlayersInBothDirections(actor, players);
    const dominionTargets = Array.from(players.values()).filter((target) => target.alive && target.id !== actor.id && dominionCells.has(target.gridIndex ?? -1)).map((target) => target.id);
    return [...new Set([...sideTargets, ...dominionTargets])];
  }
  if (effect === 'dream_path') { const target = players.get(actionTargets(action)[0]); return target ? playersOnCells(actor, clockwiseCells(actor.gridIndex ?? 0, target.gridIndex ?? 0, count), players) : []; }
  if (effect === 'hangup') return Array.from(players.values()).filter((target) => target.alive && target.id !== actor.id).map((target) => target.id);
  const sequence = requireAction(action.actionId).napoleonSequence;
  if (sequence === 'TTAA') {
    const target = players.get(actionTargets(action)[0]);
    return target ? playersOnCells(actor, cellsAround(target.gridIndex ?? 0, count, 2), players) : [];
  }
  if (sequence === 'ATA') return playersOnCells(actor, cellsAround(actor.gridIndex ?? 0, count, 1), players);
  if (sequence === 'AAAA') return playersOnCells(actor, cellsAround(actor.gridIndex ?? 0, count, 2), players);
  if (sequence === 'AAAAA') return Array.from(players.values()).filter((target) => target.alive && target.id !== actor.id).map((target) => target.id);
  return directTargets(actor, action, players);
}

function validateDeferredFlexibleSpend(player: CombatPlayer, action: SubmittedAction, definition: ActionDefinition): void {
  if (!definition.deferredFlexibleCost || actionTargets(action).length === 0) return;
  const spend = action.resourceSpend ?? {};
  if (Object.values(spend).reduce((sum, value) => sum + value, 0) !== action.power) throw new Error(`请选择合计 ${action.power} 点资源`);
  for (const [resourceId, amount] of Object.entries(spend)) if (!definition.deferredFlexibleCost.resourceIds.includes(resourceId) || !Number.isInteger(amount) || amount < 0 || resourceValue(player, resourceId) + 1e-6 < amount) throw new Error('度神决只能支付可用的整数气、蓄力或魂');
}

function validateHellwalkerSpend(player: CombatPlayer, action: SubmittedAction, definition: ActionDefinition): void {
  const required = player.buffs?.has('hellwalker') && definition.category === 'attack';
  if (!required) { if (action.extraResourceSpend !== undefined) throw new Error('该行动不接受地狱行者支付'); return; }
  const spend = action.extraResourceSpend ?? {};
  if (Object.values(spend).reduce((sum, value) => sum + value, 0) !== 1) throw new Error('地狱行者要求额外支付 1 点任意资源');
  for (const amount of Object.values(spend)) if (!Number.isInteger(amount) || amount < 0) throw new Error('地狱行者支付必须使用整数资源');
  for (const resourceId of new Set([...Object.keys(costForSubmittedAction(player, action)), ...Object.keys(action.resourceSpend ?? {}), ...Object.keys(spend)])) {
    const requiredAmount = (costForSubmittedAction(player, action)[resourceId] ?? 0) + (action.resourceSpend?.[resourceId] ?? 0) + (spend[resourceId] ?? 0);
    if (resourceValue(player, resourceId) + 1e-6 < requiredAmount) throw new Error('地狱行者支付的资源不足');
  }
}

function validateDirectionTarget(player: CombatPlayer, destination: number | undefined, players: ReadonlyMap<string, CombatPlayer>): void {
  const cellCount = players.size * 2; const current = player.gridIndex ?? 0;
  if (!Number.isInteger(destination) || (destination !== (current + 1) % cellCount && destination !== (current - 1 + cellCount) % cellCount)) throw new Error('请选择顺时针或逆时针方向');
}

function actionCanDealAttackDamage(actor: CombatPlayer, action: SubmittedAction): boolean {
  if (action.actionId === 'soul_reap') return false;
  if (requireAction(action.actionId).category === 'attack') return true;
  return actor.characterId === 'ao' && buffStacks(actor, 'ao_mastery') >= 4
    && ['steal', 'double_steal', 'absorb_charge'].includes(action.actionId);
}

function actionLevelAgainst(actor: CombatPlayer, action: SubmittedAction | undefined, opponentId: string, players: Map<string, CombatPlayer>): number {
  if (!action) return 0;
  const definition = requireAction(action.actionId);
  if (definition.multiHit) {
    const hitCount = directTargets(actor, action, players).filter((targetId) => targetId === opponentId).length;
    return hitCount * multiHitSkillLevel(definition);
  }
  if (definition.repeatAttack && actionAppliesAgainst(actor, action, opponentId, players)) {
    return repeatHitCount(actor, players.get(opponentId), definition) * submittedActionLevel(actor, action);
  }
  if (definition.category === 'defense' || actionAppliesAgainst(actor, action, opponentId, players)) {
    return submittedActionLevel(actor, action);
  }
  return 0;
}

function actionAppliesAgainst(actor: CombatPlayer, action: SubmittedAction, opponentId: string, players: Map<string, CombatPlayer>): boolean {
  const mode = requireAction(action.actionId).target.mode;
  return mode === 'none' || mode === 'all_enemies' || potentialTargets(actor, action, players).includes(opponentId);
}

function playersOnCells(actor: CombatPlayer, cells: number[], players: Map<string, CombatPlayer>): string[] { return Array.from(players.values()).filter((target) => target.alive && target.id !== actor.id && cells.includes(target.gridIndex ?? -1)).map((target) => target.id); }

function firstPlayersInBothDirections(actor: CombatPlayer, players: Map<string, CombatPlayer>): string[] {
  const count = players.size * 2; const result: string[] = [];
  for (const direction of [-1, 1]) for (let distance = 1; distance < count; distance += 1) {
    const cell = ((actor.gridIndex ?? 0) + direction * distance + count) % count;
    const target = Array.from(players.values()).find((player) => player.alive && player.id !== actor.id && player.gridIndex === cell);
    if (target) { result.push(target.id); break; }
  }
  return [...new Set(result)];
}

function finishNightmareDash(actor: CombatPlayer, target: CombatPlayer | undefined, players: Map<string, CombatPlayer>): void {
  removeBuff(actor, 'nightmare_dash_ready'); if (!target) return;
  if (!target.alive || target.currentHp <= 0) actor.gridIndex = target.gridIndex;
  else actor.gridIndex = ((target.gridIndex ?? 0) + 1) % (players.size * 2);
}

function repeatHitCount(actor: CombatPlayer, target: CombatPlayer | undefined, definition: ActionDefinition): number {
  const repeat = definition.repeatAttack;
  if (!repeat) return 1;
  let hits = repeat.baseHits;
  if (target && repeat.targetBuffId && target.buffs?.has(repeat.targetBuffId)) hits += repeat.extraHitsWhenTargetBuffed ?? 0;
  if (repeat.actorBuffId) hits += buffStacks(actor, repeat.actorBuffId) * (repeat.hitsPerActorBuffStack ?? 0);
  return hits;
}

function tryMove(actor: CombatPlayer, destination: number | undefined, players: Map<string, CombatPlayer>): boolean {
  if (destination === undefined || destination === actor.gridIndex) return false;
  actor.gridIndex = destination; return true;
}

function wakeMudrock(player: CombatPlayer, early: boolean, summary: string[]): void {
  const slept = Math.max(1, buffStacks(player, 'sleep_progress')); const remaining = buffStacks(player, 'sleeping');
  if (early) gainResource(player, 'energy', remaining);
  removeBuff(player, 'sleeping'); removeBuff(player, 'sleep_progress'); setBuff(player, 'mud_slash_unlocked'); setBuff(player, 'mud_awakened', slept * 0.5, slept);
  summary.push(`${player.nickname} 从沉睡中苏醒，获得斩与 ${formatLevel(slept * 0.5)} 级攻击加成${early ? `，返还 ${remaining} 气` : ''}。`);
}

function directTargets(actor: CombatPlayer, action: SubmittedAction, players: Map<string, CombatPlayer>): string[] {
  if (primaryEffect(action) === 'hangup') return Array.from(players.values()).filter((target) => target.id !== actor.id && target.alive).map((target) => target.id);
  const definition = requireAction(action.actionId);
  if (definition.locksTarget || definition.target.mode === 'none' || definition.target.mode === 'all_enemies') return actionTargets(action);
  if (!action.targetGridIndices?.length) return actionTargets(action);
  const intendedTargets = actionTargets(action);
  return (action.targetGridIndices ?? []).flatMap((cell, index) => {
    const occupants = Array.from(players.values()).filter((target) => target.alive && target.id !== actor.id && target.gridIndex === cell);
    const intended = occupants.find((target) => target.id === intendedTargets[index]);
    return intended ? [intended.id] : occupants.length ? [occupants[0].id] : [];
  });
}
function movementPriority(action: SubmittedAction): number { return requireAction(action.actionId).movement ? 1 : 0; }
function isDirectAttack(effect: EffectHandlerId): boolean { return ['wave', 'fist', 'slash', 'atomic_breath', 'sovereign_blade', 'stardust', 'hangup', 'sword_aura', 'open_heaven_gate', 'aoao_divine', 'immortal_palm', 'void_pierce', 'hollow_fist', 'dissipation', 'dismantle', 'bully', 'shred', 'body_slam'].includes(effect); }
function clockwiseCells(from: number, to: number, count: number): number[] { const cells: number[] = []; for (let cell = (from + 1) % count; ; cell = (cell + 1) % count) { cells.push(cell); if (cell === to || cells.length >= count - 1) break; } return cells; }
function directedPathCells(from: number, to: number, count: number, direction: -1 | 1): number[] {
  const cells = [from];
  if (from === to) return cells;
  for (let cell = (from + direction + count) % count; cells.length < count; cell = (cell + direction + count) % count) {
    cells.push(cell);
    if (cell === to) break;
  }
  return cells;
}
function cellsAround(center: number, count: number, radius: number): number[] { const cells = [center]; for (let offset = 1; offset <= radius; offset += 1) cells.push((center + offset) % count, (center - offset + count) % count); return cells; }
function hasDreamPathBonus(player: CombatPlayer): boolean {
  return player.characterId === 'nightmare' && Array.from(roundBoardObjects.get(player)?.values() ?? [])
    .some((object) => object.definitionId === 'dream_path' && object.gridIndex === player.gridIndex);
}

export function requireAction(actionId: string): ActionDefinition { const definition = actionById.get(actionId); if (!definition) throw new Error('未知行动'); return definition; }
function primaryEffect(action: SubmittedAction | undefined): EffectHandlerId | undefined { return action ? requireAction(action.actionId).effects[0]?.handler : undefined; }
function actionTargets(action: SubmittedAction): string[] { return action.targetIds ?? (action.targetId ? [action.targetId] : []); }
function resourceValue(player: CombatPlayer, resourceId: string): number { return player.resources[resourceId] ?? 0; }
function rewardDevour(player: CombatPlayer, action: SubmittedAction | undefined, summary: string[]): void { const choice = action?.resourceChoice; if (!hasPassive(player, 'devour_heaven') || !choice) return; gainResource(player, choice, 1); summary.push(`${player.nickname} 的吞天获得 1 ${choice === 'energy' ? '气' : '蓄力'}。`); }
function gainResource(player: CombatPlayer, resourceId: string, amount: number): void {
  if (amount <= 0) return;
  player.resources[resourceId] = resourceValue(player, resourceId) + amount;
  if (hasPassive(player, 'sacrifice_path') && (resourceId === 'energy' || resourceId === 'charge')) {
    const progress = buffStacks(player, 'sacrifice_path_progress') + amount;
    setBuff(player, 'sacrifice_path_progress', progress);
    if (progress >= 3) setBuff(player, 'sacrifice_path_active');
  }
  if (hasPassive(player, 'wuyou_awareness') && (resourceId === 'energy' || resourceId === 'charge')) setBuff(player, 'wuyou_awareness', buffStacks(player, 'wuyou_awareness') + amount);
}
function buffStacks(player: CombatPlayer, buffId: string): number { return player.buffs?.has(buffId) ? player.buffStacks?.[buffId] ?? 1 : 0; }
function hasPassive(player: CombatPlayer, passiveId: string): boolean { return characterById.get(player.characterId ?? '')?.passiveIds?.includes(passiveId) === true || (player.characterId === 'ye_qingxian' && player.learnedPassiveIds?.includes(passiveId) === true); }
function setBuff(player: CombatPlayer, buffId: string, stacks = 1, remainingTurns?: number): void {
  player.buffs ??= new Set(); player.buffStacks ??= {}; player.buffRemainingTurns ??= {};
  if (stacks <= 0) return removeBuff(player, buffId);
  player.buffs.add(buffId); player.buffStacks[buffId] = stacks;
  if (remainingTurns !== undefined) player.buffRemainingTurns[buffId] = Math.max(player.buffRemainingTurns[buffId] ?? 0, remainingTurns);
}
function removeBuff(player: CombatPlayer, buffId: string): void { player.buffs?.delete(buffId); if (player.buffStacks) delete player.buffStacks[buffId]; if (player.buffRemainingTurns) delete player.buffRemainingTurns[buffId]; if (player.buffSourcePlayerIds) delete player.buffSourcePlayerIds[buffId]; }
function recordWarriorHealthShift(player: CombatPlayer, hpBefore: number): void {
  if (!hasPassive(player, 'tear_passive')) return;
  const shifts = Math.max(0, hpBefore - player.currentHp);
  if (shifts <= 0) return;
  setBuff(player, 'strength', buffStacks(player, 'strength') + shifts);
  setBuff(player, 'shred_count', buffStacks(player, 'shred_count') + shifts);
}
function clearArmorOnDeath(player: CombatPlayer): void { if (player.currentHp <= 0) removeBuff(player, 'armor'); }

function applyHellwalker(source: CombatPlayer, center: CombatPlayer, players: Map<string, CombatPlayer>, summary: string[]): void {
  const count = players.size * 2; const origin = center.gridIndex ?? 0;
  const candidates = Array.from(players.values()).filter((player) => player.alive && player.id !== source.id).sort((left, right) => {
    const leftClockwise = ((left.gridIndex ?? 0) - origin + count) % count; const rightClockwise = ((right.gridIndex ?? 0) - origin + count) % count;
    const leftDistance = Math.min(leftClockwise, count - leftClockwise); const rightDistance = Math.min(rightClockwise, count - rightClockwise);
    return leftDistance - rightDistance || leftClockwise - rightClockwise || left.id.localeCompare(right.id);
  }).slice(0, center.id === source.id ? 2 : 3);
  const affected = candidates.filter((target) => applyDebuff(source, target, 'hellwalker', 1, 3));
  for (const target of affected) { target.buffSourcePlayerIds ??= {}; target.buffSourcePlayerIds.hellwalker = source.id; }
  if (affected.length) summary.push(`${source.nickname} 的地狱行者影响了${affected.map((player) => player.nickname).join('、')}。`);
}

function convertedActionCost(player: CombatPlayer, action: SubmittedAction, threshold: number): number {
  if (action.actionId === 'fist' && player.characterId === 'mudrock') return 2;
  if (threshold >= 3 && ['fist', 'double_steal', 'heal', 'winning_hand'].includes(action.actionId)) return 4;
  const definition = requireAction(action.actionId);
  const normal = Object.entries(costForSubmittedAction(player, action)).filter(([id]) => id === 'energy' || id === 'charge').reduce((sum, [, amount]) => sum + amount, 0);
  const flexible = Object.entries(action.resourceSpend ?? {}).filter(([id]) => id === 'energy' || id === 'charge').reduce((sum, [, amount]) => sum + amount, 0);
  const surcharge = Object.entries(action.extraResourceSpend ?? {}).filter(([id]) => id === 'energy' || id === 'charge').reduce((sum, [, amount]) => sum + amount, 0);
  const total = normal + flexible + surcharge;
  return total > 0 ? total : definition.damageLevel === 0 || !actionCanDealAttackDamage(player, action) ? 1 : 0;
}

function applyInnerGuardLoss(player: CombatPlayer, startingDevices: number, requestedLoss: number, eliminated: Set<string>, sourceGridIndex?: number, state?: RoundDamageState): DamageOutcome {
  const intended = startingDevices - requestedLoss;
  const locked = startingDevices >= 2 && intended <= 1;
  player.currentHp = locked ? 1 : Math.max(0, intended);
  setBuff(player, 'inner_guard_devices', player.currentHp);
  if (locked) setBuff(player, 'unbroken', 1, 2);
  const actualLoss = Math.max(0, startingDevices - player.currentHp);
  if (actualLoss > 0 && sourceGridIndex !== undefined) {
    const createdIds = addDominion(player, sourceGridIndex);
    if (state) state.createdDominionIds = createdIds;
  }
  if (player.currentHp <= 0) { player.alive = false; eliminated.add(player.id); return 'shifted_out'; }
  if (player.currentHp === 1 && startingDevices > 1 && (!state || !state.grantedEnergy)) {
    gainResource(player, 'energy', 1);
    if (state) state.grantedEnergy = true;
  }
  return 'shifted';
}

function validateQuickAttackDestination(player: CombatPlayer, destination: number | undefined, players: ReadonlyMap<string, CombatPlayer>, boardObjects: ReadonlyMap<string, CombatBoardObject>): void {
  if (players.size < 3) return validateAdjacentDestination(player, destination, players, boardObjects);
  const cellCount = players.size * 2;
  if (!Number.isInteger(destination) || destination! < 0 || destination! >= cellCount || destination === player.gridIndex) throw new Error('请选择任意其他地块');
}

function resolveCollapsingFear(actor: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, players: Map<string, CombatPlayer>, boardObjects: Map<string, CombatBoardObject>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const nearDeath = actor.currentHp === 1;
  const sideTargets = firstPlayersInBothDirections(actor, players);
  const dominionCells = new Set(Array.from(boardObjects.values()).filter((object) => object.definitionId === 'dominion' && object.ownerPlayerId === actor.id).map((object) => object.gridIndex));
  const dominionTargets = Array.from(players.values()).filter((target) => target.alive && target.id !== actor.id && dominionCells.has(target.gridIndex ?? -1)).map((target) => target.id);
  const dominionTargetSet = new Set(dominionTargets);
  resolveAttackTargets(actor, submitted, definition, sideTargets.filter((targetId) => !dominionTargetSet.has(targetId)), nearDeath ? 3 : 2, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
  resolveAttackTargets(actor, submitted, definition, dominionTargets, nearDeath ? 4 : 3, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
}

function niluFires(owner: CombatPlayer): CombatBoardObject[] {
  return Array.from(roundBoardObjects.get(owner)?.values() ?? []).filter((object) => object.definitionId === 'nilu_fire' && object.ownerPlayerId === owner.id);
}

function niluFireMitigation(player: CombatPlayer): number { return player.characterId === 'quilon' ? niluFires(player).length * 0.5 : 0; }
function applyDebuff(source: CombatPlayer, target: CombatPlayer, buffId: string, stacks = 1, remainingTurns?: number): boolean {
  if (source.id !== target.id && target.buffs?.has('nilu_resistance')) return false;
  setBuff(target, buffId, stacks, remainingTurns); return true;
}

function syncNiluResistance(player: CombatPlayer): void {
  if (player.characterId === 'quilon' && niluFires(player).length > 0) setBuff(player, 'nilu_resistance');
  else removeBuff(player, 'nilu_resistance');
}

function summonNiluFire(actor: CombatPlayer, gridIndex: number | undefined, players: Map<string, CombatPlayer>, summary: string[]): void {
  const objects = roundBoardObjects.get(actor);
  const objectId = `nilu_fire:${actor.id}:${gridIndex}`;
  if (!objects || gridIndex === undefined || objects.has(objectId)) {
    summary.push(`${actor.nickname} 的呼吸法没有生成新的尼卢火。`);
    return;
  }
  objects.set(objectId, { objectId, definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: actor.id, sourceCharacterId: 'quilon', gridIndex, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true });
  syncNiluResistance(actor);
  summary.push(`${actor.nickname} 在 ${gridIndex} 号地块布置了尼卢火。`);
}

function layDreamPath(actor: CombatPlayer, cells: readonly number[], summary: string[]): void {
  const objects = roundBoardObjects.get(actor); if (!objects) return;
  for (const gridIndex of cells) {
    const objectId = `dream_path:${gridIndex}`;
    const existing = objects.get(objectId);
    if (existing) {
      existing.ownerPlayerId = actor.id;
      existing.remainingTurns = 4;
      existing.permanent = false;
      continue;
    }
    objects.set(objectId, {
      objectId, definitionId: 'dream_path', kind: 'terrain', ownerPlayerId: actor.id, sourceCharacterId: 'nightmare', gridIndex,
      stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 4, permanent: false,
    });
  }
  summary.push(`${actor.nickname} 铺设了持续 3 回合的魇之梦径。`);
}

function tickBoardObjects(boardObjects: Map<string, CombatBoardObject>): void {
  for (const object of Array.from(boardObjects.values())) {
    if (object.permanent) continue;
    object.remainingTurns = Math.max(0, object.remainingTurns - 1);
    if (object.remainingTurns === 0) boardObjects.delete(object.objectId);
  }
}

function triggerNiluFires(actor: CombatPlayer, triggeringDefinition: ActionDefinition, count: number, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const fires = niluFires(actor); const cellCount = players.size * 2;
  if (!fires.length) return;
  const fireAttack = { ...triggeringDefinition, id: 'nilu_fire', name: '尼卢火', damageType: 'true' as const };
  for (let trigger = 0; trigger < count; trigger += 1) {
    for (const target of players.values()) {
      if (!target.alive || target.id === actor.id) continue;
      const overlappingFires = fires.filter((fire) => cellsAround(fire.gridIndex, cellCount, 1).includes(target.gridIndex ?? -1));
      if (!overlappingFires.length) continue;
      const level = overlappingFires.length * 0.5;
      applyAttack(actor, target, fireAttack, level, players, actions, blockers, immune, fragile, eliminated, shelter, cellCount, summary, performance, level);
    }
  }
  summary.push(`${actor.nickname} 的 ${fires.length} 团尼卢火引燃了 ${count} 次。`);
}

function resolveFirePurification(actor: CombatPlayer, definition: ActionDefinition, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const fires = niluFires(actor); const cellCount = players.size * 2;
  for (const fire of fires) for (const target of players.values()) {
    if (!target.alive || target.id === actor.id || !cellsAround(fire.gridIndex, cellCount, 2).includes(target.gridIndex ?? -1)) continue;
    const level = 1.5 + (actor.buffs?.has('bodhisattva_debate') ? 0.5 : 0);
    applyAttack(actor, target, definition, level, players, actions, blockers, immune, fragile, eliminated, shelter, cellCount, summary, performance, level);
  }
  summary.push(fires.length ? `${actor.nickname} 引动 ${fires.length} 团尼卢火施展清火执。` : `${actor.nickname} 使用清火执，但场上没有尼卢火。`);
}

function resolveFivePrecepts(actor: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const targetId = directTargets(actor, submitted, players)[0]; const target = players.get(targetId); const targetAction = target && actions.get(target.id);
  const targetAttackLevel = targetAction && requireAction(targetAction.actionId).category === 'attack' ? submittedActionLevel(target, targetAction) : 0;
  const matchedSkill = Math.max(1.5, targetAttackLevel) + niluFires(actor).length * 0.5 + (actor.buffs?.has('bodhisattva_debate') ? 0.5 : 0);
  const opposing = target ? actionLevelAgainst(target, targetAction, actor.id, players) : 0;
  if (!target || matchedSkill - opposing < 0.5) { summary.push(`${actor.nickname} 的惩五戒未能胜过目标招式，五戒不落。`); return; }
  for (const damageLevel of [0.5, 0.5, 1, 1.5, 1.5]) {
    const hit = { ...definition, skillLevel: matchedSkill, damageLevel };
    resolveAttackTargets(actor, submitted, hit, [targetId], matchedSkill, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
    triggerNiluFires(actor, definition, 1, players, actions, blockers, immune, fragile, eliminated, shelter, summary, performance);
  }
}

function summonLotusSeat(actor: CombatPlayer, directionCell: number | undefined, players: Map<string, CombatPlayer>, summary: string[]): void {
  const objects = roundBoardObjects.get(actor); if (!objects) return;
  const objectId = `lotus_seat:${actor.id}`;
  if (objects.has(objectId)) { summary.push(`${actor.nickname} 的托生莲座已经在场。`); return; }
  const gridIndex = actor.gridIndex ?? 0; const cellCount = players.size * 2;
  const movementDirection = directionCell === (gridIndex + 1) % cellCount ? 1 : -1;
  objects.set(objectId, {
    objectId, definitionId: 'lotus_seat', kind: 'summon', ownerPlayerId: actor.id, sourceCharacterId: 'quilon', gridIndex,
    stacks: 1, currentHp: 10, maxHp: 10, remainingTurns: 0, permanent: true,
    originGridIndex: gridIndex, movementDirection, moveSpeed: 4, cargo: {},
  });
  summary.push(`${actor.nickname} 在 ${gridIndex} 号地块召唤托生莲座，选择${movementDirection > 0 ? '顺时针' : '逆时针'}移动。`);
}

function moveLotusSeats(boardObjects: Map<string, CombatBoardObject>, players: Map<string, CombatPlayer>, speed: number, movedThisRound: Set<string>, summary: string[]): void {
  const cellCount = players.size * 2;
  const lotuses = Array.from(boardObjects.values()).filter((object) => object.definitionId === 'lotus_seat' && object.currentHp > 0 && (object.moveSpeed ?? 4) === speed).sort((left, right) => left.objectId.localeCompare(right.objectId));
  for (const lotus of lotuses) {
    if (movedThisRound.has(lotus.objectId)) continue;
    movedThisRound.add(lotus.objectId);
    const owner = players.get(lotus.ownerPlayerId);
    if (!owner?.alive) { refundLotusCargo(lotus, players); boardObjects.delete(lotus.objectId); continue; }
    lotus.gridIndex = (lotus.gridIndex + (lotus.movementDirection ?? 1) + cellCount) % cellCount;
    if (lotus.gridIndex === (lotus.originGridIndex ?? owner.gridIndex ?? 0)) {
      const totals = totalLotusCargo(lotus); gainResource(owner, 'energy', totals.energy); gainResource(owner, 'charge', totals.charge);
      boardObjects.delete(lotus.objectId);
      summary.push(`${owner.nickname} 的托生莲座返回起点，带回 ${formatLevel(totals.energy)} 气与 ${formatLevel(totals.charge)} 蓄力。`);
      continue;
    }
    const occupants = Array.from(players.values()).filter((player) => player.alive && player.gridIndex === lotus.gridIndex);
    if (!occupants.length) { summary.push(`${owner.nickname} 的托生莲座移动到 ${lotus.gridIndex} 号地块。`); continue; }
    let absorbed = false;
    for (const occupant of occupants) {
      const energy = Math.ceil(resourceValue(occupant, 'energy') / 2); const charge = Math.ceil(resourceValue(occupant, 'charge') / 2);
      if (energy <= 0 && charge <= 0) { summary.push(`${owner.nickname} 的托生莲座经过 ${occupant.nickname}，但没有吸收到资源。`); continue; }
      occupant.resources.energy = Math.max(0, resourceValue(occupant, 'energy') - energy);
      occupant.resources.charge = Math.max(0, resourceValue(occupant, 'charge') - charge);
      lotus.cargo ??= {}; const cargo = lotus.cargo[occupant.id] ?? { energy: 0, charge: 0 };
      cargo.energy += energy; cargo.charge += charge; lotus.cargo[occupant.id] = cargo; absorbed = true;
      summary.push(`${owner.nickname} 的托生莲座从 ${occupant.nickname} 吸收 ${formatLevel(energy)} 气与 ${formatLevel(charge)} 蓄力。`);
    }
    if (absorbed) { lotus.moveSpeed = 1; summary.push(`${owner.nickname} 的托生莲座之后以速度 1 移动。`); }
  }
}

function resolveBoardObjectAttack(actor: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, boardObjects: Map<string, CombatBoardObject>, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const object = submitted.targetBoardObjectId ? boardObjects.get(submitted.targetBoardObjectId) : undefined;
  if (!object || object.definitionId !== 'lotus_seat' || object.currentHp <= 0) { summary.push(`${actor.nickname} 的${definition.name}没有有效的托生莲座目标。`); return; }
  const damage = definition.id === 'five_precepts'
    ? [0.5, 0.5, 1, 1.5, 1.5].reduce((total, level) => total + level + (actor.buffs?.has('bodhisattva_debate') ? 0.5 : 0), 0)
    : submittedDamageLevel(actor, submitted);
  object.currentHp = Math.max(0, object.currentHp - damage);
  summary.push(`${actor.nickname} 的${definition.name}对托生莲座造成 ${formatLevel(damage)} 点伤害，剩余 ${formatLevel(object.currentHp)} 点生命。`);
  if (definition.id === 'five_precepts' && actor.characterId === 'quilon') for (let hit = 0; hit < 5; hit += 1) triggerNiluFires(actor, definition, 1, players, actions, blockers, immune, fragile, eliminated, shelter, summary, performance);
  if (object.currentHp > 0) return;
  refundLotusCargo(object, players); boardObjects.delete(object.objectId); summary.push('托生莲座被击毁，携带的资源已经返还给原玩家。');
}

function totalLotusCargo(lotus: CombatBoardObject): { energy: number; charge: number } {
  return Object.values(lotus.cargo ?? {}).reduce((total, cargo) => ({ energy: total.energy + cargo.energy, charge: total.charge + cargo.charge }), { energy: 0, charge: 0 });
}

function refundLotusCargo(lotus: CombatBoardObject, players: Map<string, CombatPlayer>): void {
  for (const [playerId, cargo] of Object.entries(lotus.cargo ?? {})) {
    const player = players.get(playerId); if (!player) continue;
    gainResource(player, 'energy', cargo.energy); gainResource(player, 'charge', cargo.charge);
  }
}

function removeQuilonObjectsForDeadOwners(boardObjects: Map<string, CombatBoardObject>, players: Map<string, CombatPlayer>, summary: string[]): void {
  const removedOwnerIds = new Set<string>();
  for (const object of Array.from(boardObjects.values())) {
    if (object.sourceCharacterId !== 'quilon' || players.get(object.ownerPlayerId)?.alive) continue;
    if (object.definitionId === 'lotus_seat') refundLotusCargo(object, players);
    removedOwnerIds.add(object.ownerPlayerId);
    boardObjects.delete(object.objectId);
    if (object.definitionId === 'lotus_seat') summary.push('奎隆死亡，托生莲座消失并返还了携带资源。');
  }
  for (const ownerId of removedOwnerIds) { const owner = players.get(ownerId); if (owner) removeBuff(owner, 'nilu_resistance'); }
}

function removeOwnedQuilonObjectsImmediately(owner: CombatPlayer): void {
  const boardObjects = roundBoardObjects.get(owner); const players = roundPlayers.get(owner);
  if (!boardObjects || !players) return;
  for (const object of Array.from(boardObjects.values())) {
    if (object.sourceCharacterId !== 'quilon' || object.ownerPlayerId !== owner.id) continue;
    if (object.definitionId === 'lotus_seat') refundLotusCargo(object, players);
    boardObjects.delete(object.objectId);
  }
  removeBuff(owner, 'nilu_resistance');
}

function addDominion(owner: CombatPlayer, sourceGridIndex: number): string[] {
  const objects = roundBoardObjects.get(owner); const count = roundBoardCellCounts.get(owner) ?? 0;
  if (!objects || count <= 0) return [];
  const createdIds: string[] = [];
  for (const gridIndex of cellsAround(sourceGridIndex, count, 1)) {
    const objectId = `dominion:${owner.id}:${gridIndex}`; const existing = objects.get(objectId);
    if (existing) continue;
    objects.set(objectId, {
      objectId,
      definitionId: 'dominion',
      kind: 'terrain',
      ownerPlayerId: owner.id,
      sourceCharacterId: 'inner_guard',
      gridIndex,
      stacks: 1,
      currentHp: 0,
      maxHp: 0,
      remainingTurns: 0,
      permanent: true,
    });
    createdIds.push(objectId);
  }
  return createdIds;
}

function removeCreatedDominions(owner: CombatPlayer, objectIds: string[]): void {
  const objects = roundBoardObjects.get(owner); if (!objects) return;
  for (const objectId of objectIds) objects.delete(objectId);
}
function forge(player: CombatPlayer, amount: number): number { const previous = buffStacks(player, 'sovereign_blade_forged'); const next = previous + amount; setBuff(player, 'sovereign_blade_forged', next); if (previous === 0) setBuff(player, 'sovereign_blade_active'); return next; }

function submittedActionLevel(player: CombatPlayer, action: SubmittedAction | undefined): number {
  if (!action || player.buffs?.has('fear_action_canceled')) return 0; const definition = requireAction(action.actionId); let level = definition.variable && action.power !== undefined ? (definition.variable.skillLevelPerPower ?? definition.variable.levelPerPower) * action.power : definition.skillLevel ?? definition.level;
  if (definition.defenseBreak?.mode === 'persistent' && player.buffs?.has(definition.defenseBreak.brokenBuffId!)) return 0;
  if (definition.id === 'slash' && player.buffs?.has('axe_raised')) level += 0.5;
  if (definition.id === 'slash' && hasPassive(player, 'child_of_earth')) level += buffStacks(player, 'mud_awakened');
  if (definition.id === 'fist' && hasPassive(player, 'child_of_earth')) level += buffStacks(player, 'mud_fist_level') * 0.5;
  if (['steal', 'absorb_charge'].includes(definition.id) && hasPassive(player, 'practice_makes_perfect')) { const stage = buffStacks(player, 'ao_mastery'); level = (stage >= 1 ? 0.5 : 0) + (stage >= 3 ? 1 : 0); }
  if (definition.id === 'aoao_divine') level += buffStacks(player, 'ao_mastery') * 0.5;
  if (primaryEffect(action) === 'sovereign_blade') level = buffStacks(player, 'sovereign_blade_forged');
  if (action.actionId === 'harmony_with_light') level = buffStacks(player, 'harmony_uses') + 1;
  if (action.actionId === 'void_pierce') level = buffStacks(player, 'tempered');
  if (action.actionId === 'redirect') level = 0.5 + buffStacks(player, 'tempered');
  if (action.actionId === 'see_through') level = 0.5 + buffStacks(player, 'tempered');
  if (action.actionId === 'shatter') level = 1 + buffStacks(player, 'tempered');
  if (action.actionId === 'transcend_detonate') level = 3 + buffStacks(player, 'transcendence_progress') * 0.5;
  if (action.actionId === 'deify' && action.power !== undefined) level = action.power - 1;
  if (action.actionId === 'intimidate') level = resourceValue(player, 'soul');
  if (action.actionId === 'bully') level = 0.5 + actionTargets(action).reduce((highest, targetId) => Math.max(highest, buffStacks(roundPlayers.get(player)?.get(targetId) ?? player, 'vulnerability')), 0) * 0.5;
  if (action.actionId === 'body_slam') level = buffStacks(player, 'armor');
  if (player.characterId === 'napoleon') level += buffStacks(player, 'tactical_advantage') * 0.5;
  if (player.characterId === 'quilon' && player.buffs?.has('bodhisattva_debate') && definition.category === 'attack') level += 0.5;
  if (hasPassive(player, 'tear_passive') && definition.category === 'attack') level += buffStacks(player, 'strength') * 0.5;
  if ((player.buffs?.has('transcendence') || player.buffs?.has('transcendence_permanent')) && action.actionId !== 'transcend_detonate') level += buffStacks(player, 'transcendence_progress') * 0.5;
  if (player.buffs?.has('iridescence_afterglow')) level = Math.max(1.5, level);
  if (definition.category === 'attack' && actionTargets(action).some((targetId) => roundPlayers.get(player)?.get(targetId)?.buffs?.has('resentment_mark'))) level += 0.5;
  return level;
}

function submittedDamageLevel(player: CombatPlayer, action: SubmittedAction | undefined): number {
  if (!action || player.buffs?.has('fear_action_canceled')) return 0;
  const definition = requireAction(action.actionId);
  const debateBonus = player.characterId === 'quilon' && player.buffs?.has('bodhisattva_debate') && definition.category === 'attack' ? 0.5 : 0;
  if (action.actionId === 'shred') return Math.max(0, submittedActionLevel(player, action)
    - (player.buffs?.has('soul_reap_debuff') && definition.category === 'attack' ? 0.5 : 0));
  if (hasPassive(player, 'tear_passive') && definition.category === 'attack') {
    const targetVulnerability = actionTargets(action).reduce((highest, targetId) => Math.max(highest, buffStacks(roundPlayers.get(player)?.get(targetId) ?? player, 'vulnerability')), 0);
    const baseDamage = action.actionId === 'bully' ? 0.5 + targetVulnerability * 0.5
      : action.actionId === 'body_slam' ? buffStacks(player, 'armor')
        : definition.damageLevel ?? (definition.variable?.damageLevelPerPower !== undefined && action.power !== undefined ? definition.variable.damageLevelPerPower * action.power : definition.level);
    return Math.max(0, baseDamage - (player.buffs?.has('soul_reap_debuff') ? 0.5 : 0));
  }
  if (definition.multiHit) return multiHitDamageLevel(definition) + debateBonus;
  if (definition.damageLevel !== undefined) return Math.max(0, definition.damageLevel + debateBonus - (player.buffs?.has('soul_reap_debuff') && definition.category === 'attack' ? 0.5 : 0));
  if (definition.variable?.damageLevelPerPower !== undefined && action.power !== undefined) return definition.variable.damageLevelPerPower * action.power + debateBonus;
  return Math.max(0, submittedActionLevel(player, action) - (player.buffs?.has('soul_reap_debuff') && definition.category === 'attack' ? 0.5 : 0));
}

function multiHitSkillLevel(definition: ActionDefinition): number {
  return definition.variable?.skillLevelPerPower ?? definition.variable?.levelPerPower ?? definition.skillLevel ?? definition.level;
}

function multiHitDamageLevel(definition: ActionDefinition): number {
  return definition.damageLevel ?? definition.variable?.damageLevelPerPower ?? multiHitSkillLevel(definition);
}

function costForSubmittedAction(player: CombatPlayer, action: SubmittedAction): Record<string, number> {
  if (action.actionId === 'transform' && action.transformCharacterId) return characterById.get(action.transformCharacterId)?.transformationCost ?? {};
  const definition = requireAction(action.actionId); const cost = { ...definition.cost };
  if (action.actionId === 'slash' && hasPassive(player, 'sword_dao')) cost.energy = 1 / 3;
  if (action.actionId === 'ten_volt' && player.buffs?.has('quick_attack_ready')) cost.charge = 0;
  if (action.actionId === 'collapsing_fear' && player.characterId === 'inner_guard' && player.currentHp === 1) cost.energy = 2;
  if (definition.variable && action.power !== undefined) cost[definition.variable.resourceId] = (cost[definition.variable.resourceId] ?? 0) + definition.variable.costPerPower * action.power;
  return cost;
}

function actionSpeed(playerId: string, action: SubmittedAction, player: CombatPlayer | undefined, players?: ReadonlyMap<string, CombatPlayer>, actions?: ReadonlyMap<string, SubmittedAction>): number {
  let speed = requireAction(action.actionId).speedPriority + (player?.buffs?.has('dark_shelter_power') ? 1 : 0);
  if (action.actionId === 'deify') speed = action.capturedSpeed ?? (player ? resourceValue(player, 'soul') : 0);
  if (player?.characterId === 'ku' && ['void_pierce', 'censure', 'redirect', 'see_through'].includes(action.actionId)) speed = Math.ceil(1 + 0.5 * buffStacks(player, 'tempered'));
  if (player?.characterId === 'ku' && action.actionId === 'shatter') speed = 1 + buffStacks(player, 'tempered');
  if (player?.buffs?.has('transcendence') || player?.buffs?.has('transcendence_permanent')) speed += buffStacks(player, 'transcendence_progress');
  if (player?.buffs?.has('swayed')) speed -= 1;
  if (player?.buffs?.has('soul_reap_debuff')) speed -= 1;
  if (player?.characterId === 'napoleon') speed += buffStacks(player, 'napoleon_speed') + buffStacks(player, 'napoleon_divine') * 0.5;
  if (action.actionId === 'five_precepts') {
    const target = players?.get(actionTargets(action)[0] ?? ''); const targetAction = target && actions?.get(target.id);
    if (targetAction && targetAction.actionId !== 'five_precepts' && requireAction(targetAction.actionId).category === 'attack') speed = Math.max(speed, actionSpeed(target.id, targetAction, target, players, actions));
  }
  return Math.max(0, Math.min(4, speed));
}

function actionEffectSpeed(playerId: string, action: SubmittedAction, player: CombatPlayer | undefined, kind: EffectKind, players?: ReadonlyMap<string, CombatPlayer>, actions?: ReadonlyMap<string, SubmittedAction>): number {
  const definition = requireAction(action.actionId);
  return Math.max(0, Math.min(4, actionSpeed(playerId, action, player, players, actions)
    + effectSpeedPriority(definition, kind) - definition.speedPriority));
}

function submittedDefenseLevel(player: CombatPlayer, action: SubmittedAction, definition: ActionDefinition): number {
  if (definition.defenseLevel === undefined) return submittedActionLevel(player, action);
  return definition.defenseLevel + buffStacks(player, 'tactical_advantage') * 0.5;
}

function addTacticalAdvantage(player: CombatPlayer, amount: number, remainingTurns: number): void {
  setBuff(player, 'tactical_advantage', Math.min(6, buffStacks(player, 'tactical_advantage') + amount), remainingTurns + 1);
}

function consumeNapoleonStrategy(buffer: string, sequence: string, command?: 'A' | 'D' | 'T'): string {
  const prepared = command ? `${buffer}${command}`.slice(-6) : buffer;
  const index = command ? prepared.length - sequence.length : prepared.indexOf(sequence);
  if (index < 0) return prepared;
  return `${prepared.slice(0, index)}${prepared.slice(index + sequence.length)}`;
}

function sacrificeResource(player: CombatPlayer, action: SubmittedAction): string | undefined {
  if (!hasPassive(player, 'sacrifice_path') || (!player.buffs?.has('sacrifice_path_active') && buffStacks(player, 'sacrifice_path_progress') < 3) || player.currentHp <= 0) return undefined;
  const deficits = Object.entries(costForSubmittedAction(player, action)).filter(([resourceId, amount]) => amount - resourceValue(player, resourceId) > 1e-6);
  return deficits.length === 1 && Math.abs(deficits[0][1] - resourceValue(player, deficits[0][0]) - 1) < 1e-6 ? deficits[0][0] : undefined;
}

function rewardTempered(player: CombatPlayer, summary: string[]): void {
  const next = Math.min(4, buffStacks(player, 'tempered') + 1); setBuff(player, 'tempered', next); gainResource(player, 'energy', 0.5); summary.push(`${player.nickname} 应对成功，千锤百炼提升至 ${formatLevel(next)} 层并获得 0.5 气。`);
}

function consumeTranscendenceRevive(player: CombatPlayer, hpBeforeDamage: number): boolean {
  const temporary = player.buffs?.has('transcendence') === true;
  const permanent = player.buffs?.has('transcendence_permanent') === true;
  if (!temporary && !permanent) return false;
  removeBuff(player, 'transcendence'); removeBuff(player, 'transcendence_permanent'); removeBuff(player, 'transcendence_progress');
  if (temporary && hpBeforeDamage <= 1) return false;
  player.currentHp = 1;
  return true;
}

function consumeDeathRevive(player: CombatPlayer, hpBeforeDamage: number): boolean {
  if (consumeTranscendenceRevive(player, hpBeforeDamage)) return true;
  return queueWuyouRevive(player);
}

function queueWuyouRevive(player: CombatPlayer): boolean {
  if (player.characterId !== 'quilon' || player.buffs?.has('wuyou_used')) return false;
  pendingWuyouRevives.add(player);
  return true;
}

function resolvePendingWuyouRevives(players: Map<string, CombatPlayer>, eliminated: Set<string>, summary: string[]): void {
  for (const player of players.values()) {
    if (!pendingWuyouRevives.has(player)) continue;
    pendingWuyouRevives.delete(player);
    if (player.currentHp > 0) continue;
    eliminated.delete(player.id); player.alive = true;
    setBuff(player, 'wuyou_used'); setBuff(player, 'bodhisattva_debate');
    for (const buffId of NEGATIVE_BUFF_IDS) removeBuff(player, buffId);
    roundFragilePlayers.get(player)?.delete(player.id);
    player.currentHp = player.maxHp;
    summary.push(`${player.nickname} 在本回合全部伤害结算后触发无忧觉，恢复至健康状态并获得菩萨辩。`);
  }
}

const NEGATIVE_BUFF_IDS = ['fragile', 'fear', 'darkness', 'shock', 'defense_forbidden', 'attack_forbidden', 'swayed', 'calibrated', 'fear_action_canceled'] as const;

function validateGridTarget(destination: number | undefined, players: ReadonlyMap<string, CombatPlayer>): void {
  const cellCount = players.size * 2;
  if (!Number.isInteger(destination) || destination! < 0 || destination! >= cellCount) throw new Error('请选择有效地块');
}

function validateEmptyUnitGridTarget(destination: number | undefined, players: ReadonlyMap<string, CombatPlayer>, boardObjects: ReadonlyMap<string, CombatBoardObject>): void {
  validateGridTarget(destination, players);
  const occupiedByPlayer = Array.from(players.values()).some((player) => player.alive && player.gridIndex === destination);
  const occupiedBySummon = Array.from(boardObjects.values()).some((object) => object.kind === 'summon' && object.currentHp > 0 && object.gridIndex === destination);
  if (occupiedByPlayer || occupiedBySummon) throw new Error('请选择没有单位的地块');
}

function redirectAttackTarget(attacker: CombatPlayer, targetId: string, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, summary: string[]): string {
  const target = players.get(targetId); const redirect = target && actions.get(target.id);
  if (!target || target.characterId !== 'ku' || primaryEffect(redirect) !== 'redirect' || actionTargets(redirect!)[0] === undefined) return targetId;
  if (actionTargets(redirect!)[0] !== attacker.id || target.buffs?.has('redirect_triggered')) return targetId;
  const living = Array.from(players.values()).filter((player) => player.alive);
  const count = players.size * 2; let redirected = attacker.id;
  if (living.length > 2) for (let distance = 1; distance < count; distance += 1) {
    const cell = ((target.gridIndex ?? 0) + distance) % count;
    const candidate = living.find((player) => player.id !== target.id && player.gridIndex === cell);
    if (candidate) { redirected = candidate.id; break; }
  }
  setBuff(target, 'redirect_triggered'); rewardTempered(target, summary); summary.push(`${target.nickname} 将 ${attacker.nickname} 的攻击挪移给 ${players.get(redirected)?.nickname ?? redirected}。`); return redirected;
}
function formatLevel(value: number): string { if (Math.abs(value - 1 / 3) < 1e-6) return '1/3'; return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function healthStateName(player: CombatPlayer): string { if (!player.alive || player.currentHp <= 0) return '死亡状态'; if (player.maxHp > 1 && player.currentHp === 1) return '濒死状态'; return '健康状态'; }
function resolutionActor(playerId: string, action: SubmittedAction) { const definition = requireAction(action.actionId); return { playerId, actionId: action.actionId, targetIds: actionTargets(action), poseId: definition.vfxId || undefined, transformCharacterId: action.transformCharacterId, power: action.power, targetGridIndex: action.targetGridIndex, targetBoardObjectId: action.targetBoardObjectId }; }
function describeSubmittedAction(player: CombatPlayer, action: SubmittedAction | undefined, players: ReadonlyMap<string, CombatPlayer>): string { if (!action) return `${player.nickname}：未提交`; const definition = requireAction(action.actionId); if (action.actionId === 'transform') return `${player.nickname}：变身为${characterById.get(action.transformCharacterId ?? '')?.name ?? action.transformCharacterId ?? '未知角色'}`; const targets = summarizeTargets(actionTargets(action), players); return `${player.nickname}：${definition.name}${action.power === undefined ? '' : `（n=${action.power}）`}${action.targetBoardObjectId ? ' → 托生莲座' : targets ? ` → ${targets}` : ''}`; }
function summarizeTargets(targetIds: string[], players: ReadonlyMap<string, CombatPlayer>): string {
  const counts = new Map<string, number>();
  for (const targetId of targetIds) counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  return Array.from(counts, ([targetId, count]) => `${players.get(targetId)?.nickname ?? targetId}${count > 1 ? ` ×${count}` : ''}`).join('、');
}
