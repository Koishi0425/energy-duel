import {
  actionById,
  canExecuteNapoleonStrategy,
  characterById,
  napoleonStrategyFromCommand,
  type ActionDefinition,
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
  commandBuffer?: string;
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
}

export interface SubmittedAction {
  actionId: string;
  targetId?: string;
  targetIds?: string[];
  transformCharacterId?: string;
  power?: number;
  targetGridIndex?: number;
  resourceSpend?: Record<string, number>;
  resourceChoice?: 'energy' | 'charge';
  napoleonStrategySource?: 'buffer' | 'command';
  napoleonCommand?: 'A' | 'D' | 'T';
}

export interface RoundResult {
  summary: string[];
  eliminated: string[];
  steps: ResolutionStep[];
  performance: Record<string, RoundPerformance>;
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
}

const roundDamageStates = new WeakMap<CombatPlayer, RoundDamageState>();
const roundBoardObjects = new WeakMap<CombatPlayer, Map<string, CombatBoardObject>>();
const roundBoardCellCounts = new WeakMap<CombatPlayer, number>();

export function validateAction(player: CombatPlayer, action: SubmittedAction, players: ReadonlyMap<string, CombatPlayer>): void {
  if (!player.alive) throw new Error('已淘汰玩家不能出招');
  const definition = requireAction(action.actionId);
  if (player.buffs?.has('fear') && action.actionId !== 'charge' && player.characterId !== 'napoleon') throw new Error('恐惧期间只能使用「气」');
  if (player.buffs?.has('defense_forbidden') && definition.category === 'defense') throw new Error('崩裂禁防期间不能使用防御技能');
  if (player.buffs?.has('attack_forbidden') && definition.category === 'attack') throw new Error('全面压制期间不能使用攻击技能');
  if (definition.napoleonSequence) {
    if (action.napoleonStrategySource === 'buffer') {
      if (action.napoleonCommand !== undefined || !canExecuteNapoleonStrategy(player.commandBuffer ?? '', definition.napoleonSequence)) throw new Error('当前指令缓冲无法执行该策略');
    } else if (action.napoleonStrategySource === 'command') {
      const triggered = action.napoleonCommand && napoleonStrategyFromCommand(player.commandBuffer ?? '', action.napoleonCommand);
      if (!triggered || triggered.id !== definition.id) throw new Error('当前指令不会触发该策略');
    } else throw new Error('请选择已有策略或触发它的指令');
  } else if (action.napoleonStrategySource !== undefined || action.napoleonCommand !== undefined) throw new Error('该行动不接受拿破仑策略来源');
  if (['immortal_palm', 'rule_the_world'].includes(action.actionId) && !['energy', 'charge'].includes(action.resourceChoice ?? '')) throw new Error('请选择吞天获得气或蓄力');
  const variable = definition.variable;
  if (variable) {
    if (!Number.isInteger(action.power) || (action.power ?? 0) < variable.minPower
      || (variable.maxPower !== undefined && (action.power ?? 0) > variable.maxPower)) throw new Error('请选择有效的技能参数 n');
    if (definition.usesAllVariableResource) {
      const allInPower = Math.floor((resourceValue(player, variable.resourceId) + 1e-6) / variable.costPerPower);
      if (action.power !== allInPower) throw new Error(`该行动必须消耗当前全部${variable.resourceId}资源`);
    }
  } else if (action.power !== undefined) throw new Error('该行动不接受参数 n');
  const sacrifice = sacrificeResource(player, action);
  for (const [resourceId, amount] of Object.entries(costForSubmittedAction(player, action))) {
    if (resourceValue(player, resourceId) + 1e-6 < amount && sacrifice !== resourceId) throw new Error(`${resourceId}资源不足`);
  }
  validateFlexibleSpend(player, action, definition);
  const targets = actionTargets(action);
  const deferredPending = (definition.target.selectionTiming === 'deferred'
    || (['steal', 'absorb_charge'].includes(action.actionId) && player.characterId === 'ao' && buffStacks(player, 'ao_mastery') >= 2)) && targets.length === 0;
  if (definition.target.mode === 'single_enemy') {
    if (!deferredPending && targets.length !== 1) throw new Error('请选择其他存活玩家作为目标');
  } else if (definition.target.mode === 'multiple_enemies') {
    const expected = definition.target.maxTargetsByPower ? action.power : definition.target.maxTargets;
    if (!deferredPending && targets.length !== expected) throw new Error(`请选择 ${expected} 次目标`);
  } else if (targets.length > 0) throw new Error('该行动不接受单体目标');
  for (const targetId of targets) {
    const target = players.get(targetId);
    if (!target || !target.alive || target.id === player.id || target.buffs?.has('sleeping')) throw new Error('请选择其他可被选中的存活玩家作为目标');
  }
  if (definition.targetsGridCell && action.actionId === 'quick_attack') validateAdjacentDestination(player, action.targetGridIndex, players);
  else if (definition.targetsGridCell) validateGridTarget(action.targetGridIndex, players);
  else if (action.targetGridIndex !== undefined && action.actionId !== 'dream_path') throw new Error('该行动不接受地块目标');
  if (action.actionId === 'dream_path' && action.targetGridIndex !== undefined) validateAdjacentDestination(player, action.targetGridIndex, players);
}

function validateFlexibleSpend(player: CombatPlayer, action: SubmittedAction, definition: ActionDefinition): void {
  if (!definition.anyResourceCost) {
    if (action.resourceSpend !== undefined) throw new Error('该行动不接受任意资源支付');
    return;
  }
  const required = Math.max(1, definition.anyResourceCost - (definition.id === 'aoao_divine' ? buffStacks(player, 'ao_mastery') : 0));
  const spend = action.resourceSpend ?? {};
  if (Math.abs(Object.values(spend).reduce((sum, value) => sum + value, 0) - required) > 1e-6) throw new Error(`请选择合计 ${required} 点资源`);
  for (const [resourceId, amount] of Object.entries(spend)) {
    if (!Number.isInteger(amount) || amount < 0 || resourceValue(player, resourceId) + 1e-6 < amount) throw new Error('任意资源支付必须使用整数点数');
  }
}

function validateAdjacentDestination(player: CombatPlayer, destination: number | undefined, players: ReadonlyMap<string, CombatPlayer>): void {
  const cellCount = players.size * 2;
  if (!Number.isInteger(destination) || destination! < 0 || destination! >= cellCount) throw new Error('请选择相邻空地');
  const current = player.gridIndex ?? 0;
  const adjacent = destination === (current + 1) % cellCount || destination === (current - 1 + cellCount) % cellCount;
  if (!adjacent || Array.from(players.values()).some((candidate) => candidate.alive && candidate.id !== player.id && candidate.gridIndex === destination)) throw new Error('请选择相邻空地');
}

export function buildResolutionSteps(actions: ReadonlyMap<string, SubmittedAction>, players?: ReadonlyMap<string, CombatPlayer>): ResolutionStep[] {
  const ordered = Array.from(actions.entries()).sort(([leftId, left], [rightId, right]) => {
    const speedDifference = actionSpeed(rightId, right, players?.get(rightId)) - actionSpeed(leftId, left, players?.get(leftId));
    return speedDifference || leftId.localeCompare(rightId);
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
    steps.push({ sequence: steps.length, speedPriority: actionSpeed(playerId, action, players?.get(playerId)), actors, participantIds: Array.from(new Set(actors.flatMap((actor) => [actor.playerId, ...actor.targetIds]))), durationMs: 650 });
  }
  return steps;
}

export function resolveRound(players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, boardObjects = new Map<string, CombatBoardObject>()): RoundResult {
  const summary: string[] = []; const eliminated = new Set<string>();
  const performance = Object.fromEntries(Array.from(players.keys(), (id) => [id, { damageStatesDealt: 0, eliminations: 0, successfulDefenses: 0, recoveryStates: 0 } satisfies RoundPerformance]));
  const aliveAtStart = Array.from(players.values()).filter((player) => player.alive);
  for (const player of aliveAtStart) { roundDamageStates.delete(player); roundBoardObjects.set(player, boardObjects); roundBoardCellCounts.set(player, players.size * 2); }
  const hpAtStart = new Map(aliveAtStart.map((player) => [player.id, player.currentHp]));
  for (const player of aliveAtStart) if (player.characterId === 'napoleon') {
    if (player.buffs?.has('napoleon_emperor')) addTacticalAdvantage(player, 2, Math.max(1, player.buffRemainingTurns?.napoleon_emperor ?? 1));
    if (player.buffs?.has('hundred_days')) addTacticalAdvantage(player, 1, 1);
    if (player.buffs?.has('unfallen_fortress')) addTacticalAdvantage(player, 1, Math.max(1, player.buffRemainingTurns?.unfallen_fortress ?? 1));
  }
  summary.push(`本回合行动：${aliveAtStart.map((player) => describeSubmittedAction(player, actions.get(player.id), players)).join('；')}。`);

  for (const player of aliveAtStart) {
    const action = actions.get(player.id); if (!action) continue;
    if (player.buffs?.has('sleeping') && !['continue_sleep', 'filthy_bloodline'].includes(action.actionId)) wakeMudrock(player, true, summary);
    const sacrifice = sacrificeResource(player, action);
    for (const [resourceId, amount] of Object.entries(costForSubmittedAction(player, action))) player.resources[resourceId] = Math.max(0, resourceValue(player, resourceId) - amount);
    if (sacrifice) { player.currentHp -= 1; summary.push(`${player.nickname} 以祭道抵免 1 点${sacrifice === 'energy' ? '气' : '蓄力'}缺口，进入${healthStateName(player)}。`); if (player.currentHp <= 0) { player.alive = false; eliminated.add(player.id); } }
    const strategy = requireAction(action.actionId).napoleonSequence;
    if (strategy) player.commandBuffer = consumeNapoleonStrategy(player.commandBuffer ?? '', strategy, action.napoleonStrategySource === 'command' ? action.napoleonCommand : undefined);
    for (const [resourceId, amount] of Object.entries(action.resourceSpend ?? {})) player.resources[resourceId] = resourceValue(player, resourceId) - amount;
    if (action.actionId === 'filthy_bloodline') { setBuff(player, 'sleeping', 2); setBuff(player, 'sleep_progress', 1); }
  }

  const preprocessed = new Set<string>();
  for (const player of aliveAtStart) {
    const action = actions.get(player.id); if (!action) continue;
    if (action.actionId === 'quick_attack') { const moved = tryMove(player, action.targetGridIndex, players); setBuff(player, 'quick_attack_ready'); summary.push(moved ? `${player.nickname} 使用迅雷移动到 ${player.gridIndex} 号地块。` : `${player.nickname} 的迅雷目标格已被占用，留在原地。`); preprocessed.add(player.id); }
    if (action.actionId === 'rockfall_hammer') { const before = player.currentHp; player.currentHp = Math.min(player.maxHp, player.currentHp + 1); performance[player.id].recoveryStates += player.currentHp - before; summary.push(`${player.nickname} 的岩崩锤先使其进入${healthStateName(player)}。`); }
  }

  countMudrockSelections(players, actions);
  const hasChop = aliveAtStart.some((player) => primaryEffect(actions.get(player.id)) === 'chop');
  const hasCut = aliveAtStart.some((player) => primaryEffect(actions.get(player.id)) === 'cut');
  const immune = new Set(aliveAtStart.filter((player) => primaryEffect(actions.get(player.id)) === 'super_defend' || player.buffs?.has('unbroken')).map((player) => player.id));
  const fragile = new Set(aliveAtStart.filter((player) => ['fist', 'double_steal', 'heal', 'winning_hand'].includes(primaryEffect(actions.get(player.id)) ?? '') && player.characterId !== 'mudrock').map((player) => player.id));
  const blockers = new Map(aliveAtStart.flatMap((player) => {
    const action = actions.get(player.id); const definition = action && requireAction(action.actionId); return definition && (definition.category === 'defense' || definition.defenseLevel !== undefined) ? [[player.id, definition]] as const : [];
  }));
  const darkShelterAbsorbs = chooseDarkShelterAbsorbs(players, actions);
  const attackAttempts = new Set<string>(); const canceledAttackTargets = new Set<string>(); const canceledActors = new Set<string>(); const canceledReasons = new Map<string, string>(); const processed = new Set<string>();

  if (hasChop) resolveGlobalCounter(['steal', 'double_steal'], '凹类技能', '剁', 'chop', aliveAtStart, actions, eliminated, summary);
  if (hasChop) for (const actor of aliveAtStart.filter((player) => player.characterId === 'ku' && primaryEffect(actions.get(player.id)) === 'chop')) {
    const successes = aliveAtStart.filter((player) => ['steal', 'double_steal'].includes(primaryEffect(actions.get(player.id)) ?? '')).length;
    for (let index = 0; index < successes; index += 1) rewardTempered(actor, summary);
  }
  if (hasCut) resolveGlobalCounter(['absorb_charge'], '吸', '削', 'cut', aliveAtStart, actions, eliminated, summary, fragile);

  const chargeClaims = new Set<string>(); const absorbClaims = new Set<string>(); const preclaimedResources = new Set<string>();
  if (!hasChop) for (const actor of aliveAtStart) {
    const submitted = actions.get(actor.id); const effect = primaryEffect(submitted); if (!submitted || !['steal', 'double_steal'].includes(effect ?? '')) continue;
    for (const targetId of actionTargets(submitted)) {
      const target = players.get(targetId);
      if (primaryEffect(actions.get(targetId)) === 'charge' && !chargeClaims.has(targetId)) { chargeClaims.add(targetId); actor.resources.energy = resourceValue(actor, 'energy') + 1; preclaimedResources.add(actor.id); summary.push(`${actor.nickname} 从 ${target?.nickname ?? targetId} 偷取 1 气。`); if (actor.characterId === 'ku') rewardTempered(actor, summary); }
      else summary.push(`${actor.nickname} 的${requireAction(submitted.actionId).name}没有从 ${target?.nickname ?? targetId} 获得气：目标本回合没有出气。`);
    }
  }
  if (!hasCut) for (const actor of aliveAtStart) {
    const submitted = actions.get(actor.id); if (!submitted || primaryEffect(submitted) !== 'absorb_charge') continue;
    const targetId = actionTargets(submitted)[0]; const target = players.get(targetId);
    if (targetId && primaryEffect(actions.get(targetId)) === 'gain_charge' && !absorbClaims.has(targetId)) { absorbClaims.add(targetId); actor.resources.charge = resourceValue(actor, 'charge') + 1; preclaimedResources.add(actor.id); summary.push(`${actor.nickname} 从 ${target?.nickname ?? targetId} 吸取 1 蓄力。`); if (actor.characterId === 'ku') rewardTempered(actor, summary); }
    else summary.push(`${actor.nickname} 的吸没有获得蓄力。`);
  }

  const ordered = aliveAtStart.filter((player) => actions.has(player.id)).sort((left, right) => {
    const speed = actionSpeed(right.id, actions.get(right.id)!, right) - actionSpeed(left.id, actions.get(left.id)!, left);
    return speed || left.id.localeCompare(right.id);
  });
  for (const actor of ordered) {
    const submitted = actions.get(actor.id)!; const definition = requireAction(submitted.actionId); const effect = primaryEffect(submitted)!;
    if (!actor.alive || eliminated.has(actor.id)) { processed.add(actor.id); continue; }
    if (canceledActors.has(actor.id)) { summary.push(`${actor.nickname} 的${definition.name}${canceledReasons.get(actor.id) ?? '被取消'}，未能结算。`); processed.add(actor.id); continue; }
    let gainedResource = preclaimedResources.has(actor.id);
    if (effect === 'transform') {
      const previous = actor.characterId; const next = submitted.transformCharacterId ?? actor.characterId; if (previous === 'napoleon') removeBuff(actor, 'tactical_advantage'); actor.characterId = next; actor.currentFormId = 'base'; actor.maxHp = next === 'default_character' ? 1 : next === 'inner_guard' ? 3 : 2; actor.currentHp = actor.maxHp; actor.commandBuffer = '';
      if (next === 'regent' && !actor.buffs?.has('regent_claimed')) { actor.resources.stars = resourceValue(actor, 'stars') + 3; setBuff(actor, 'regent_claimed'); summary.push(`${actor.nickname} 首次成为储君，获得 3 辉星。`); }
      if (next === 'ao') for (const player of players.values()) setBuff(player, 'cut_granted');
      summary.push(`${actor.nickname} 变身为${characterById.get(next ?? '')?.name ?? next}。`);
    } else if (effect === 'quick_attack' && !preprocessed.has(actor.id)) {
      actor.gridIndex = submitted.targetGridIndex; setBuff(actor, 'quick_attack_ready'); summary.push(`${actor.nickname} 使用迅雷移动到 ${actor.gridIndex} 号地块。`);
    } else if (effect === 'charge') {
      if (!chargeClaims.has(actor.id)) { actor.resources.energy = resourceValue(actor, 'energy') + 1; gainedResource = true; summary.push(`${actor.nickname} 使用气，获得 1 气。`); }
      else summary.push(`${actor.nickname} 使用气，但产生的 1 气被偷取。`);
    } else if (effect === 'gain_charge') {
      if (!absorbClaims.has(actor.id)) { actor.resources.charge = resourceValue(actor, 'charge') + 1; gainedResource = true; summary.push(`${actor.nickname} 获得 1 蓄力。`); }
      else summary.push(`${actor.nickname} 使用蓄力，但产生的蓄力被吸走。`);
    } else if (['steal', 'double_steal'].includes(effect) && !hasChop) {
      if (actor.characterId === 'ao' && buffStacks(actor, 'ao_mastery') >= 4) resolveAttackTargets(actor, submitted, definition, actionTargets(submitted), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
    } else if (effect === 'absorb_charge' && !hasCut) {
      const targetId = actionTargets(submitted)[0]; const target = players.get(targetId);
      if (buffStacks(actor, 'ao_mastery') >= 4 && targetId) resolveAttackTargets(actor, submitted, definition, [targetId], submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
    } else if (effect === 'heal') { const before = actor.currentHp; actor.currentHp = Math.min(actor.maxHp, actor.currentHp + 1); performance[actor.id].recoveryStates += actor.currentHp - before; summary.push(`${actor.nickname} 使用治疗，进入${healthStateName(actor)}。`); }
    else if (effect === 'raise_axe') { setBuff(actor, 'axe_raised'); summary.push(`${actor.nickname} 举起战斧。`); }
    else if (effect === 'hidden_cache') { actor.resources.stars = resourceValue(actor, 'stars') + 1; setBuff(actor, 'hidden_cache_pending'); gainedResource = true; summary.push(`${actor.nickname} 获得 1 辉星，并将在下回合开始时再获得 3 辉星。`); }
    else if (effect === 'winning_hand') { actor.resources.stars = resourceValue(actor, 'stars') + 9; gainedResource = true; summary.push(`${actor.nickname} 获得 9 辉星。`); }
    else if (effect === 'forge_sword') summary.push(`${actor.nickname} 将君王之剑锻造至 ${formatLevel(forge(actor, 3))}。`);
    else if (effect === 'forge_wall') summary.push(`${actor.nickname} 将君王之剑锻造至 ${formatLevel(forge(actor, 1))}。`);
    else if (effect === 'summon_forth') { const level = forge(actor, 0.5); setBuff(actor, 'sovereign_blade_active'); summary.push(`${actor.nickname} 将君王之剑锻造至 ${formatLevel(level)} 并激活。`); }
    else if (effect === 'filthy_bloodline') summary.push(`${actor.nickname} 进入沉睡，无法被选中并免疫伤害。`);
    else if (effect === 'continue_sleep') { const remaining = Math.max(0, buffStacks(actor, 'sleeping') - 1); setBuff(actor, 'sleep_progress', buffStacks(actor, 'sleep_progress') + 1); if (remaining > 0) setBuff(actor, 'sleeping', remaining); else wakeMudrock(actor, false, summary); }
    else if (effect === 'harmony_with_light') { const uses = buffStacks(actor, 'harmony_uses') + 1; setBuff(actor, 'harmony_uses', uses); setBuff(actor, 'star_body', buffStacks(actor, 'star_body') + (actor.buffs?.has('transcendence') || actor.buffs?.has('transcendence_permanent') ? 1 : 0.5)); summary.push(`${actor.nickname} 的和光同尘提升至 ${formatLevel(uses)} 级，并积累神体。`); }
    else if (effect === 'create_star_core') { setBuff(actor, 'transcendence', 1, 4); setBuff(actor, 'transcendence_progress', 0); summary.push(`${actor.nickname} 进入超脱状态。`); }
    else if (effect === 'transcend_fuse') { removeBuff(actor, 'transcendence'); setBuff(actor, 'transcendence_permanent'); summary.push(`${actor.nickname} 将超脱融合为永久状态。`); }
    else if (effect === 'transcend_detonate') { resolveAttackTargets(actor, submitted, definition, directTargets(actor, submitted, players), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); removeBuff(actor, 'transcendence'); removeBuff(actor, 'transcendence_permanent'); removeBuff(actor, 'transcendence_progress'); }
    else if (effect === 'nebula_shock') { const targetId = actionTargets(submitted)[0]; resolveAttackTargets(actor, submitted, definition, [targetId], submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); const target = players.get(targetId); if (target?.alive) setBuff(target, 'shock', 1, 2); }
    else if (effect === 'rule_the_world') { const targets = playersOnCells(actor, cellsAround(submitted.targetGridIndex ?? actor.gridIndex ?? 0, players.size * 2, 2), players); resolveAttackTargets(actor, submitted, definition, targets, submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); for (const targetId of targets) { const target = players.get(targetId); if (target && actionLevelAgainst(target, actions.get(targetId), actor.id, players) <= 3) setBuff(target, 'fear', 1, 2); } }
    else if (effect === 'censure') { const targetId = actionTargets(submitted)[0]; const targetAction = actions.get(targetId); if (!processed.has(targetId) && targetAction && requireAction(targetAction.actionId).category === 'resource') { canceledActors.add(targetId); canceledReasons.set(targetId, '被杖责截断资源收益'); rewardTempered(actor, summary); } resolveAttackTargets(actor, submitted, definition, [targetId], submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); }
    else if (effect === 'see_through') { const targetId = actionTargets(submitted)[0]; const targetAction = actions.get(targetId); const success = Boolean(!processed.has(targetId) && targetAction && ['attack', 'special'].includes(requireAction(targetAction.actionId).category)); const level = success ? 0.5 + buffStacks(actor, 'tempered') : 0.5; if (success) { canceledActors.add(targetId); canceledReasons.set(targetId, '被看破取消'); blockers.delete(targetId); rewardTempered(actor, summary); } resolveAttackTargets(actor, submitted, definition, [targetId], level, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); }
    else if (effect === 'shatter') { const targetId = actionTargets(submitted)[0]; const targetAction = actions.get(targetId); const success = Boolean(targetAction && requireAction(targetAction.actionId).category === 'defense'); const mastery = buffStacks(actor, 'tempered'); const level = 1 + mastery + (success ? mastery * 0.5 : 0); if (success) { const target = players.get(targetId); if (target) setBuff(target, 'defense_forbidden', 1, 2); rewardTempered(actor, summary); } resolveAttackTargets(actor, submitted, definition, [targetId], level, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); }
    else if (effect === 'collapsing_fear') resolveCollapsingFear(actor, submitted, definition, players, boardObjects, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
    else if (['attack_order', 'defense_order', 'tactical_order'].includes(effect)) { const command = effect === 'attack_order' ? 'A' : effect === 'defense_order' ? 'D' : 'T'; actor.commandBuffer = `${actor.commandBuffer ?? ''}${command}`.slice(-6); if (effect === 'attack_order') resolveAttackTargets(actor, submitted, definition, actionTargets(submitted), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); summary.push(`${actor.nickname} 的指令缓冲为 ${actor.commandBuffer}。`); }
    else if (effect === 'napoleon_strategy') resolveNapoleonStrategy(actor, submitted, definition, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
    else if (effect === 'shadow_blade') { resolveSpatialAttack(actor, submitted, definition, cellsAround(actor.gridIndex ?? 0, players.size * 2, 1), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); setBuff(actor, 'shadow_blade_cooldown', 4); }
    else if (effect === 'ten_volt' || effect === 'hundred_thousand_volt') { const targets = firstPlayersInBothDirections(actor, players); resolveAttackTargets(actor, submitted, definition, targets, submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); if (effect === 'ten_volt') removeBuff(actor, 'quick_attack_ready'); }
    else if (effect === 'dream_path') { const target = players.get(actionTargets(submitted)[0]); const start = actor.gridIndex ?? 0; const cells = target ? clockwiseCells(start, target.gridIndex ?? 0, players.size * 2) : []; resolveSpatialAttack(actor, submitted, definition, cells, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); if (target) { setBuff(actor, 'dream_path', (target.gridIndex ?? 0) + 1, 3); setBuff(actor, 'dream_path_start', start + 1, 3); } }
    else if (effect === 'rockfall_hammer') { resolveSpatialAttack(actor, submitted, definition, cellsAround(actor.gridIndex ?? 0, players.size * 2, 2), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); setBuff(actor, 'hammer_ready', Math.max(0, buffStacks(actor, 'hammer_ready') - 1)); }
    else if (effect === 'haunting_shadows') { for (const player of players.values()) if (player.id !== actor.id) setBuff(player, 'darkness', 1, 2); setBuff(actor, 'nightmare_dash_ready', 1, 2); if (actionTargets(submitted).length) { resolveAttackTargets(actor, submitted, definition, actionTargets(submitted), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); finishNightmareDash(actor, players.get(actionTargets(submitted)[0]), players); } summary.push(`${actor.nickname} 令其他玩家陷入黑暗。`); }
    else if (effect === 'nightmare_dash') { resolveAttackTargets(actor, submitted, definition, actionTargets(submitted), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance); finishNightmareDash(actor, players.get(actionTargets(submitted)[0]), players); }
    else if (effect === 'silent_fear') {
      const targetId = actionTargets(submitted)[0]; const target = players.get(targetId); const targetAction = actions.get(targetId);
      if (target && actionLevelAgainst(target, targetAction, actor.id, players) <= submittedActionLevel(actor, submitted)) { setBuff(target, 'fear', 1, 2); if (!processed.has(targetId) && targetAction?.actionId !== 'charge') { canceledActors.add(targetId); canceledReasons.set(targetId, '因无言恐惧失效'); blockers.delete(targetId); setBuff(target, 'fear_action_canceled'); } }
      summary.push(target ? `${actor.nickname} 的无言恐惧笼罩 ${target.nickname}，但不造成伤害。` : `${actor.nickname} 的无言恐惧没有有效目标。`);
    } else if (isDirectAttack(effect)) resolveAttackTargets(actor, submitted, definition, directTargets(actor, submitted, players), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);

    if (gainedResource && actor.characterId === 'ao') setBuff(actor, 'ao_mastery', Math.min(4, buffStacks(actor, 'ao_mastery') + 1));
    if (effect === 'aoao_divine') removeBuff(actor, 'ao_mastery');
    if (effect === 'sovereign_blade') removeBuff(actor, 'sovereign_blade_active');
    if (actor.characterId === 'mudrock' && effect === 'fist') setBuff(actor, 'mud_fist_level', buffStacks(actor, 'mud_fist_level') + 1);
    if (definition.cooldownReduction && actor.buffs?.has(definition.cooldownReduction.buffId)) {
      const next = buffStacks(actor, definition.cooldownReduction.buffId) - definition.cooldownReduction.stacks;
      if (next > 0) setBuff(actor, definition.cooldownReduction.buffId, next); else removeBuff(actor, definition.cooldownReduction.buffId);
    }
    processed.add(actor.id);
  }

  for (const player of aliveAtStart) {
    const effect = primaryEffect(actions.get(player.id));
    if (effect === 'collect_light' && canceledAttackTargets.has(player.id) && player.currentHp === hpAtStart.get(player.id) && !eliminated.has(player.id)) { player.resources.stars = resourceValue(player, 'stars') + 1; summary.push(`${player.nickname} 的收集光辉获得 1 辉星。`); }
    removeBuff(player, 'iridescence_afterglow'); if (effect === 'iridescence') setBuff(player, 'iridescence_afterglow');
    if (player.characterId === 'mudrock' && !player.buffs?.has('mud_barrier')) { const count = buffStacks(player, 'mud_round_counter') + (effect === 'transform' ? 0 : 1); if (count >= 4) { setBuff(player, 'mud_barrier'); setBuff(player, 'mud_round_counter', 0); summary.push(`${player.nickname} 的沃土予身生成一层屏障。`); } else setBuff(player, 'mud_round_counter', count); }
    if (effect === 'dark_shelter' && darkShelterAbsorbs.has(player.id)) { setBuff(player, 'dark_shelter_power', 1, 4); summary.push(`${player.nickname} 的黑暗庇护成功吸收攻击。`); }
    removeBuff(player, 'fear_action_canceled');
    if (effect === 'dream_path' && actions.get(player.id)?.targetGridIndex !== undefined && player.buffs?.has('dream_path')) tryMove(player, actions.get(player.id)?.targetGridIndex, players);
    if (player.buffs?.has('shock') && actions.get(player.id) && requireAction(actions.get(player.id)!.actionId).category === 'attack' && player.alive) { damagePlayer(player, 0, 0, false, eliminated, true, true, actions.get(player.id), false, player.gridIndex); summary.push(`${player.nickname} 因震荡使用攻击，进入${healthStateName(player)}。`); }
    if (player.buffs?.has('transcendence') || player.buffs?.has('transcendence_permanent')) {
      const before = player.currentHp;
      player.currentHp = Math.min(player.maxHp, player.currentHp + 1);
      performance[player.id].recoveryStates += player.currentHp - before;
      setBuff(player, 'star_body', buffStacks(player, 'star_body') + 0.5);
      setBuff(player, 'transcendence_progress', buffStacks(player, 'transcendence_progress') + 1);
    }
    resolveNapoleonCounter(player, actions.get(player.id), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary, performance);
    removeBuff(player, 'redirect_triggered');
  }
  for (const id of eliminated) { const player = players.get(id); if (player) { player.alive = false; player.currentHp = 0; } }
  for (const player of players.values()) roundDamageStates.delete(player);
  return { summary, eliminated: Array.from(eliminated), steps: buildResolutionSteps(actions, players), performance };
}

function resolveGlobalCounter(effectIds: readonly EffectHandlerId[], targetName: string, counterName: string, counterEffect: EffectHandlerId, players: CombatPlayer[], actions: ReadonlyMap<string, SubmittedAction>, eliminated: Set<string>, summary: string[], fragile = new Set<string>()): void {
  const effects = new Set(effectIds);
  const users = players.filter((player) => effects.has(primaryEffect(actions.get(player.id))!));
  const source = players.filter((player) => primaryEffect(actions.get(player.id)) === counterEffect).sort((left, right) => left.id.localeCompare(right.id))[0];
  for (const user of users) { damagePlayer(user, 1, 0, fragile.has(user.id), eliminated, true, true, actions.get(user.id), false, source?.gridIndex); summary.push(`${user.nickname} 的${targetName}被${counterName}取消，进入${healthStateName(user)}。`); }
  if (!users.length) summary.push(`有人使用${counterName}，但本回合无人使用${targetName}。`);
}

function resolveNapoleonStrategy(actor: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const sequence = definition.napoleonSequence!; const direct = actionTargets(submitted); const levelBefore = submittedActionLevel(actor, submitted);
  const directAttack = ['AA', 'AD', 'AT', 'TA', 'AAA', 'AAT', 'TAA', 'TAD', 'TTA', 'AADD', 'TATA'].includes(sequence);
  if (directAttack) {
    const target = players.get(direct[0]); const hpBefore = target?.currentHp;
    const tactical = buffStacks(actor, 'tactical_advantage');
    const level = sequence === 'TTA' ? levelBefore + tactical * 0.5 : levelBefore;
    resolveAttackTargets(actor, submitted, definition, direct, level, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
    if (sequence === 'AAT' && target && hpBefore !== undefined && target.currentHp < hpBefore) setBuff(actor, 'napoleon_speed', 2, 2);
    if (['AT', 'TAD'].includes(sequence) && target?.alive) setBuff(target, 'calibrated', 1, 2);
    if (sequence === 'TATA' && target?.alive) { setBuff(target, 'attack_forbidden', 1, 2); setBuff(actor, 'napoleon_speed', 2, 2); }
    if (['TTA', 'TTAA'].includes(sequence)) removeBuff(actor, 'tactical_advantage');
  } else if (sequence === 'ATA' || sequence === 'AAAA') {
    const radius = sequence === 'ATA' ? 1 : 2; const targets = playersOnCells(actor, cellsAround(actor.gridIndex ?? 0, players.size * 2, radius), players);
    resolveAttackTargets(actor, submitted, definition, targets, levelBefore, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
    if (sequence === 'ATA') for (const targetId of targets) { const target = players.get(targetId); if (target?.alive) setBuff(target, 'swayed', 1, 2); }
  } else if (sequence === 'AAAAA') {
    resolveAttackTargets(actor, submitted, definition, Array.from(players.values()).filter((target) => target.id !== actor.id && target.alive).map((target) => target.id), levelBefore, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
  } else if (sequence === 'TTAA') {
    const target = players.get(direct[0]);
    const targets = target ? playersOnCells(actor, cellsAround(target.gridIndex ?? 0, players.size * 2, 2), players) : [];
    const tactical = buffStacks(actor, 'tactical_advantage');
    resolveAttackTargets(actor, submitted, definition, targets, levelBefore + tactical * 0.5, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
    removeBuff(actor, 'tactical_advantage');
  }
  if (sequence === 'AT') addTacticalAdvantage(actor, 1, 3);
  if (sequence === 'DT') { setBuff(actor, 'defense_deployment', 1, 2); addTacticalAdvantage(actor, 1, 3); }
  if (sequence === 'TT') addTacticalAdvantage(actor, 2, 3);
  if (sequence === 'TTT') addTacticalAdvantage(actor, 3, 3);
  if (sequence === 'TTTT') { addTacticalAdvantage(actor, 4, 4); setBuff(actor, 'napoleon_divine', Math.min(3, buffStacks(actor, 'napoleon_divine') + 1)); }
  if (sequence === 'DDDDD') setBuff(actor, 'unfallen_fortress', 1, 4);
  if (sequence === 'TTTTT') { addTacticalAdvantage(actor, 5, 5); setBuff(actor, 'napoleon_emperor', 1, 6); }
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
    return adjustedAttackLevel(attacker, actor, action, players.size * 2) - defense < 0.5;
  }).sort(([leftId, left], [rightId, right]) => adjustedAttackLevel(players.get(rightId)!, actor, right, players.size * 2) - adjustedAttackLevel(players.get(leftId)!, actor, left, players.size * 2));
  const targetId = incoming[0]?.[0]; if (!targetId) return;
  const level = 1.5 + buffStacks(actor, 'tactical_advantage') * 0.5;
  const hpBefore = players.get(targetId)?.currentHp;
  resolveAttackTargets(actor, submitted, requireAction(submitted.actionId), [targetId], level, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
  const target = players.get(targetId); if (sequence === 'DAD' && target?.alive && hpBefore !== undefined && target.currentHp < hpBefore) setBuff(target, 'swayed', 1, 2);
}

function adjustedAttackLevel(attacker: CombatPlayer, target: CombatPlayer, action: SubmittedAction, boardCellCount: number): number {
  let level = submittedDamageLevel(attacker, action) + (target.buffs?.has('fear') ? 1 : 0) + (target.buffs?.has('calibrated') ? 1 : 0);
  if (target.buffs?.has('defense_deployment')) level = Math.max(0, level - 1);
  if (attacker.buffs?.has('dark_shelter_power')) level += 0.5;
  if (attacker.buffs?.has('dream_path') && dreamPathContains(attacker, attacker.gridIndex ?? 0, boardCellCount)) level += 0.5;
  return level;
}

function resolveSpatialAttack(attacker: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, cells: number[], players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const targets = Array.from(players.values()).filter((target) => target.id !== attacker.id && target.alive && cells.includes(target.gridIndex ?? -1)).map((target) => target.id);
  resolveAttackTargets(attacker, submitted, definition, targets, submittedActionLevel(attacker, submitted), players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
}

function resolveAttackTargets(attacker: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, targets: string[], level: number, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  if (definition.multiHit) {
    const skillLevelPerHit = multiHitSkillLevel(definition);
    const damageLevelPerHit = multiHitDamageLevel(definition);
    const allocations = new Map<string, number>();
    for (const targetId of targets) allocations.set(targetId, (allocations.get(targetId) ?? 0) + 1);
    for (const [targetId, hitCount] of allocations) {
      attempts.add(targetId);
      const target = players.get(targetId);
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
    if (applyAttack(attacker, players.get(targetId), definition, level, players, actions, blockers, immune, fragile, eliminated, shelter, players.size * 2, summary, performance) === 'none') canceled.add(targetId);
  }
}

function applyAttack(attacker: CombatPlayer, target: CombatPlayer | undefined, attack: ActionDefinition, rawLevel: number, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, shelter: Map<string, string>, boardCellCount: number, summary: string[], performance: Record<string, RoundPerformance>, explicitDamageLevel?: number): DamageOutcome {
  if (!target) return 'none';
  if (target.buffs?.has('sleeping')) { summary.push(`${target.nickname} 在沉睡中免疫了 ${attacker.nickname} 的${attack.name}。`); return 'none'; }
  const trueDamage = attack.damageType === 'true';
  const piercingDamage = attack.damageType === 'piercing';
  if (immune.has(target.id)) { performance[target.id].successfulDefenses += 1; summary.push(`${target.nickname} 的${target.buffs?.has('unbroken') ? '不破' : '超防'}挡住了 ${attacker.nickname}。`); return 'none'; }
  if (shelter.get(target.id) === attacker.id) { performance[target.id].successfulDefenses += 1; summary.push(`${target.nickname} 的黑暗庇护吸收了 ${attacker.nickname} 的${attack.name}。`); return 'none'; }
  let attackerLevel = rawLevel + (target.buffs?.has('fear') ? 1 : 0);
  let damageLevel = (explicitDamageLevel ?? attack.damageLevel ?? rawLevel) + (target.buffs?.has('fear') ? 1 : 0);
  if (target.buffs?.has('calibrated')) { attackerLevel += 1; damageLevel += 1; }
  if (target.buffs?.has('defense_deployment')) { attackerLevel = Math.max(0, attackerLevel - 1); damageLevel = Math.max(0, damageLevel - 1); }
  if (attacker.buffs?.has('dark_shelter_power')) { attackerLevel += 0.5; damageLevel += 0.5; }
  if (attacker.buffs?.has('dream_path') && dreamPathContains(attacker, attacker.gridIndex ?? 0, boardCellCount)) { attackerLevel += 0.5; damageLevel += 0.5; }
  const sourceDamageLevel = damageLevel;
  const targetAction = actions.get(target.id); const targetDefinition = targetAction ? requireAction(targetAction.actionId) : undefined; const block = piercingDamage ? undefined : blockers.get(target.id);
  const opposingSkillLevel = attacker.id !== target.id && attack.id !== 'dissipation' && targetDefinition?.category !== 'defense' ? actionLevelAgainst(target, targetAction, attacker.id, players) : 0;
  if (opposingSkillLevel > 0) {
    const skillDifference = attackerLevel - opposingSkillLevel;
    if (skillDifference < 0.5) { summary.push(`${attacker.nickname} 的${attack.name}（技能 ${formatLevel(attackerLevel)}）未胜过 ${target.nickname} 的${targetDefinition!.name}（技能 ${formatLevel(opposingSkillLevel)}）。`); return 'none'; }
    damageLevel = Math.min(damageLevel, skillDifference);
  }
  if (!trueDamage) damageLevel = Math.max(0, damageLevel - buffStacks(target, 'star_body'));
  let targetLevel = block && targetAction ? submittedDefenseLevel(target, targetAction, block) : 0;
  if (!piercingDamage && target.buffs?.has('unfallen_fortress')) targetLevel = Math.max(targetLevel, 1);
  if (targetAction && requireAction(targetAction.actionId).category === 'defense' && !block) targetLevel = 0;
  if (primaryEffect(targetAction) === 'dark_shelter') targetLevel = 0;
  if (block && damageLevel < targetLevel) { performance[target.id].successfulDefenses += 1; if (target.characterId === 'ku') rewardTempered(target, summary); summary.push(`${target.nickname} 的${block.name}抵消了 ${attacker.nickname} 的${attack.name}。`); return 'none'; }
  if (block?.defenseBreak && targetLevel > 0 && damageLevel >= targetLevel) {
    blockers.delete(target.id);
    if (block.defenseBreak.mode === 'persistent') setBuff(target, block.defenseBreak.brokenBuffId!);
    if (block.effects[0]?.handler === 'axe_defend') target.resources.energy = resourceValue(target, 'energy') + 1;
    summary.push(block.defenseBreak.mode === 'persistent'
      ? `${target.nickname} 的${block.name}被击碎，之后防御等级降为 0。`
      : `${target.nickname} 的${block.name}被击碎，本次生成的防御等级降为 0。`);
  }
  const hpBefore = target.currentHp;
  const effectiveDamageLevel = Math.max(0, damageLevel - targetLevel);
  if (effectiveDamageLevel > 0 && target.buffs?.has('mud_barrier') && targetDefinition?.category !== 'defense') { const before = target.currentHp; removeBuff(target, 'mud_barrier'); target.currentHp = Math.min(target.maxHp, target.currentHp + 1); performance[target.id].successfulDefenses += 1; performance[target.id].recoveryStates += target.currentHp - before; summary.push(`${target.nickname} 的屏障抵消攻击并使其进入${healthStateName(target)}。`); return 'none'; }
  const damageSourceGrid = attack.id === 'dissipation' ? target.gridIndex : attacker.gridIndex;
  const outcome = damagePlayer(target, effectiveDamageLevel, 0, fragile.has(target.id), eliminated, false, sourceDamageLevel < 3, targetAction, sourceDamageLevel >= 3 && effectiveDamageLevel >= 1, damageSourceGrid);
  if (outcome === 'none') performance[target.id].successfulDefenses += 1;
  else {
    const appliedStates = Math.max(0, hpBefore - target.currentHp);
    if (attacker.id !== target.id) {
      performance[attacker.id].damageStatesDealt += appliedStates;
      if (appliedStates > 0 && (outcome === 'eliminated' || outcome === 'shifted_out')) performance[attacker.id].eliminations += 1;
    }
  }
  if (outcome === 'none' && block && target.characterId === 'ku') rewardTempered(target, summary);
  if (outcome !== 'none' && attacker.characterId === 'ye_qingxian' && ['immortal_palm', 'rule_the_world'].includes(attack.id)) {
    const choice = actions.get(attacker.id)?.resourceChoice;
    if (choice) { attacker.resources[choice] = resourceValue(attacker, choice) + 1; summary.push(`${attacker.nickname} 的吞天获得 1 ${choice === 'energy' ? '气' : '蓄力'}。`); }
  }
  const comparison = `${attacker.nickname} 的${attack.name}（技能 ${formatLevel(attackerLevel)} / 伤害 ${formatLevel(damageLevel)}）对 ${target.nickname} 的${targetAction ? requireAction(targetAction.actionId).name : '无招式'}`;
  if (outcome === 'none') summary.push(`${comparison}：有效伤害不足 0.5，未造成伤害。`);
  else summary.push(`${comparison}：有效伤害 ${formatLevel(effectiveDamageLevel)}，${target.nickname} 进入${healthStateName(target)}。`);
  return outcome;
}

type DamageOutcome = 'none' | 'shifted' | 'shifted_out' | 'eliminated';
function damagePlayer(player: CombatPlayer, attackLevel: number, defenseLevel: number, isFragile: boolean, eliminated: Set<string>, forceShift = false, maxOneState = false, selected?: SubmittedAction, lethalHeavyHit = false, sourceGridIndex?: number): DamageOutcome {
  const difference = attackLevel - defenseLevel;
  if (forceShift) {
    if (player.characterId === 'inner_guard') return applyInnerGuardLoss(player, player.currentHp, 1, eliminated, sourceGridIndex);
    const hpBeforeDamage = player.currentHp;
    if (isFragile) { player.currentHp = 0; if (consumeTranscendenceRevive(player, hpBeforeDamage)) return 'shifted'; eliminated.add(player.id); return 'eliminated'; }
    player.currentHp -= 1;
    if (player.currentHp <= 0) { if (consumeTranscendenceRevive(player, hpBeforeDamage)) return 'shifted'; eliminated.add(player.id); return 'shifted_out'; }
    if (player.characterId !== 'napoleon') player.resources.energy = resourceValue(player, 'energy') + 1;
    return 'shifted';
  }
  const receivedLevel = difference;
  const previous = roundDamageStates.get(player);
  if (previous && receivedLevel <= previous.highestLevel + 1e-6 && (!lethalHeavyHit || previous.lethalHeavyHit)) return previous.outcome;
  if (previous) {
    removeCreatedDominions(player, previous.createdDominionIds);
    player.currentHp = previous.startingHp; player.alive = true; eliminated.delete(player.id);
    removeBuff(player, 'transcendence'); removeBuff(player, 'transcendence_permanent'); removeBuff(player, 'transcendence_progress');
    if (previous.transcendence === 'temporary') setBuff(player, 'transcendence', 1, previous.transcendenceRemainingTurns);
    if (previous.transcendence === 'permanent') setBuff(player, 'transcendence_permanent');
    if (previous.transcendenceProgress > 0) setBuff(player, 'transcendence_progress', previous.transcendenceProgress);
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
  };
  state.highestLevel = receivedLevel;
  state.lethalHeavyHit ||= lethalHeavyHit;
  const finish = (outcome: DamageOutcome): DamageOutcome => { state.outcome = outcome; roundDamageStates.set(player, state); return outcome; };
  const mudFistRisk = player.characterId === 'mudrock' && selected?.actionId === 'fist' && difference >= 0.5;
  if (player.characterId === 'inner_guard') {
    const requestedLoss = isFragile && difference >= 0.5 ? state.startingHp : difference >= 3 ? 2 : difference >= 0.5 ? 1 : 0;
    if (requestedLoss === 0) return finish('none');
    return finish(applyInnerGuardLoss(player, state.startingHp, requestedLoss, eliminated, sourceGridIndex, state));
  }
  if ((isFragile && (forceShift || difference >= 0.5)) || mudFistRisk) { player.currentHp = 0; if (consumeTranscendenceRevive(player, state.startingHp)) return finish('shifted'); eliminated.add(player.id); return finish('eliminated'); }
  if (state.lethalHeavyHit || (!maxOneState && difference >= 3)) { player.currentHp = 0; if (consumeTranscendenceRevive(player, state.startingHp)) return finish('shifted'); eliminated.add(player.id); return finish('eliminated'); }
  if (forceShift || difference >= 0.5) { player.currentHp -= 1; if (player.currentHp <= 0) { if (consumeTranscendenceRevive(player, state.startingHp)) return finish('shifted'); eliminated.add(player.id); return finish('shifted_out'); } if (player.characterId !== 'napoleon' && !state.grantedEnergy) { player.resources.energy = resourceValue(player, 'energy') + 1; state.grantedEnergy = true; } return finish('shifted'); }
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
    return Array.from(players.values()).filter((target) => target.alive && target.id !== actor.id && (cellsAround(actor.gridIndex ?? 0, count, 1).includes(target.gridIndex ?? -1) || dominionCells.has(target.gridIndex ?? -1))).map((target) => target.id);
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
  return actionTargets(action);
}

function actionCanDealAttackDamage(actor: CombatPlayer, action: SubmittedAction): boolean {
  if (requireAction(action.actionId).category === 'attack') return true;
  return actor.characterId === 'ao' && buffStacks(actor, 'ao_mastery') >= 4
    && ['steal', 'double_steal', 'absorb_charge'].includes(action.actionId);
}

function actionLevelAgainst(actor: CombatPlayer, action: SubmittedAction | undefined, opponentId: string, players: Map<string, CombatPlayer>): number {
  if (!action) return 0;
  const definition = requireAction(action.actionId);
  if (definition.multiHit) {
    const hitCount = actionTargets(action).filter((targetId) => targetId === opponentId).length;
    return hitCount * multiHitSkillLevel(definition);
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
  else { const count = players.size * 2; const destination = ((target.gridIndex ?? 0) + 1) % count; if (!Array.from(players.values()).some((player) => player.alive && player.id !== actor.id && player.gridIndex === destination)) actor.gridIndex = destination; }
}

function tryMove(actor: CombatPlayer, destination: number | undefined, players: Map<string, CombatPlayer>): boolean {
  if (destination === undefined || Array.from(players.values()).some((player) => player.alive && player.id !== actor.id && player.gridIndex === destination)) return false;
  actor.gridIndex = destination; return true;
}

function wakeMudrock(player: CombatPlayer, early: boolean, summary: string[]): void {
  const slept = Math.max(1, buffStacks(player, 'sleep_progress')); const remaining = buffStacks(player, 'sleeping');
  if (early) player.resources.energy = resourceValue(player, 'energy') + remaining;
  removeBuff(player, 'sleeping'); removeBuff(player, 'sleep_progress'); setBuff(player, 'mud_slash_unlocked'); setBuff(player, 'mud_awakened', slept * 0.5, slept);
  summary.push(`${player.nickname} 从沉睡中苏醒，获得斩与 ${formatLevel(slept * 0.5)} 级攻击加成${early ? `，返还 ${remaining} 气` : ''}。`);
}

function directTargets(actor: CombatPlayer, action: SubmittedAction, players: Map<string, CombatPlayer>): string[] {
  if (primaryEffect(action) === 'hangup') return Array.from(players.values()).filter((target) => target.id !== actor.id && target.alive).map((target) => target.id);
  return actionTargets(action);
}
function isDirectAttack(effect: EffectHandlerId): boolean { return ['wave', 'fist', 'slash', 'atomic_breath', 'sovereign_blade', 'stardust', 'hangup', 'sword_aura', 'open_heaven_gate', 'aoao_divine', 'immortal_palm', 'void_pierce', 'hollow_fist', 'dissipation'].includes(effect); }
function clockwiseCells(from: number, to: number, count: number): number[] { const cells: number[] = []; for (let cell = (from + 1) % count; ; cell = (cell + 1) % count) { cells.push(cell); if (cell === to || cells.length >= count - 1) break; } return cells; }
function cellsAround(center: number, count: number, radius: number): number[] { const cells = [center]; for (let offset = 1; offset <= radius; offset += 1) cells.push((center + offset) % count, (center - offset + count) % count); return cells; }
function dreamPathContains(player: CombatPlayer, cell: number, count: number): boolean { const endpoint = buffStacks(player, 'dream_path') - 1; const start = buffStacks(player, 'dream_path_start') - 1; return endpoint >= 0 && start >= 0 && clockwiseCells(start, endpoint, count).includes(cell); }

export function requireAction(actionId: string): ActionDefinition { const definition = actionById.get(actionId); if (!definition) throw new Error('未知行动'); return definition; }
function primaryEffect(action: SubmittedAction | undefined): EffectHandlerId | undefined { return action ? requireAction(action.actionId).effects[0]?.handler : undefined; }
function actionTargets(action: SubmittedAction): string[] { return action.targetIds ?? (action.targetId ? [action.targetId] : []); }
function resourceValue(player: CombatPlayer, resourceId: string): number { return player.resources[resourceId] ?? 0; }
function buffStacks(player: CombatPlayer, buffId: string): number { return player.buffs?.has(buffId) ? player.buffStacks?.[buffId] ?? 1 : 0; }
function setBuff(player: CombatPlayer, buffId: string, stacks = 1, remainingTurns?: number): void { player.buffs ??= new Set(); player.buffStacks ??= {}; player.buffRemainingTurns ??= {}; if (stacks <= 0) return removeBuff(player, buffId); player.buffs.add(buffId); player.buffStacks[buffId] = stacks; if (remainingTurns !== undefined) player.buffRemainingTurns[buffId] = remainingTurns; }
function removeBuff(player: CombatPlayer, buffId: string): void { player.buffs?.delete(buffId); if (player.buffStacks) delete player.buffStacks[buffId]; if (player.buffRemainingTurns) delete player.buffRemainingTurns[buffId]; }

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
    player.resources.energy = resourceValue(player, 'energy') + 1;
    if (state) state.grantedEnergy = true;
  }
  return 'shifted';
}

function resolveCollapsingFear(actor: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, players: Map<string, CombatPlayer>, boardObjects: Map<string, CombatBoardObject>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[], performance: Record<string, RoundPerformance>): void {
  const nearDeath = actor.currentHp === 1;
  const adjacentTargets = playersOnCells(actor, cellsAround(actor.gridIndex ?? 0, players.size * 2, 1), players);
  const dominionCells = new Set(Array.from(boardObjects.values()).filter((object) => object.definitionId === 'dominion' && object.ownerPlayerId === actor.id).map((object) => object.gridIndex));
  const dominionTargets = Array.from(players.values()).filter((target) => target.alive && dominionCells.has(target.gridIndex ?? -1)).map((target) => target.id);
  resolveAttackTargets(actor, submitted, definition, adjacentTargets, nearDeath ? 3 : 2, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
  resolveAttackTargets(actor, submitted, definition, dominionTargets, nearDeath ? 4 : 3, players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary, performance);
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
  if (definition.id === 'slash' && player.characterId === 'mudrock') level += buffStacks(player, 'mud_awakened');
  if (definition.id === 'fist' && player.characterId === 'mudrock') level += buffStacks(player, 'mud_fist_level') * 0.5;
  if (['steal', 'absorb_charge'].includes(definition.id) && player.characterId === 'ao') { const stage = buffStacks(player, 'ao_mastery'); level = (stage >= 1 ? 0.5 : 0) + (stage >= 3 ? 1 : 0); }
  if (definition.id === 'aoao_divine') level += buffStacks(player, 'ao_mastery') * 0.5;
  if (primaryEffect(action) === 'sovereign_blade') level = buffStacks(player, 'sovereign_blade_forged');
  if (action.actionId === 'harmony_with_light') level = buffStacks(player, 'harmony_uses') + 1;
  if (action.actionId === 'void_pierce') level = buffStacks(player, 'tempered');
  if (action.actionId === 'redirect') level = 0.5 + buffStacks(player, 'tempered');
  if (action.actionId === 'see_through') level = 0.5 + buffStacks(player, 'tempered');
  if (action.actionId === 'shatter') level = 1 + buffStacks(player, 'tempered');
  if (action.actionId === 'transcend_detonate') level = 3 + buffStacks(player, 'transcendence_progress') * 0.5;
  if (player.characterId === 'napoleon') level += buffStacks(player, 'tactical_advantage') * 0.5;
  if ((player.buffs?.has('transcendence') || player.buffs?.has('transcendence_permanent')) && action.actionId !== 'transcend_detonate') level += buffStacks(player, 'transcendence_progress') * 0.5;
  if (player.buffs?.has('iridescence_afterglow')) level = Math.max(1.5, level);
  return level;
}

function submittedDamageLevel(player: CombatPlayer, action: SubmittedAction | undefined): number {
  if (!action || player.buffs?.has('fear_action_canceled')) return 0;
  const definition = requireAction(action.actionId);
  if (definition.multiHit) return multiHitDamageLevel(definition);
  if (definition.damageLevel !== undefined) return definition.damageLevel;
  if (definition.variable?.damageLevelPerPower !== undefined && action.power !== undefined) return definition.variable.damageLevelPerPower * action.power;
  return submittedActionLevel(player, action);
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
  if (action.actionId === 'slash' && player.characterId === 'li_chungang') cost.energy = 1 / 3;
  if (action.actionId === 'ten_volt' && player.buffs?.has('quick_attack_ready')) cost.charge = 0;
  if (action.actionId === 'collapsing_fear' && player.characterId === 'inner_guard' && player.currentHp === 1) cost.energy = 2;
  if (definition.variable && action.power !== undefined) cost[definition.variable.resourceId] = (cost[definition.variable.resourceId] ?? 0) + definition.variable.costPerPower * action.power;
  return cost;
}

function actionSpeed(playerId: string, action: SubmittedAction, player: CombatPlayer | undefined): number {
  let speed = requireAction(action.actionId).speedPriority + (player?.buffs?.has('dark_shelter_power') ? 1 : 0);
  if (player?.characterId === 'ku' && ['void_pierce', 'censure', 'redirect', 'see_through'].includes(action.actionId)) speed = Math.ceil(1 + 0.5 * buffStacks(player, 'tempered'));
  if (player?.characterId === 'ku' && action.actionId === 'shatter') speed = 1 + buffStacks(player, 'tempered');
  if (player?.buffs?.has('transcendence') || player?.buffs?.has('transcendence_permanent')) speed += buffStacks(player, 'transcendence_progress');
  if (player?.buffs?.has('swayed')) speed -= 1;
  if (player?.characterId === 'napoleon') speed += buffStacks(player, 'napoleon_speed') + buffStacks(player, 'napoleon_divine') * 0.5;
  return speed;
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
  if (player.characterId !== 'ye_qingxian' || resourceValue(player, 'energy') + resourceValue(player, 'charge') < 3 || player.currentHp <= 0) return undefined;
  const deficits = Object.entries(costForSubmittedAction(player, action)).filter(([resourceId, amount]) => amount - resourceValue(player, resourceId) > 1e-6);
  return deficits.length === 1 && Math.abs(deficits[0][1] - resourceValue(player, deficits[0][0]) - 1) < 1e-6 ? deficits[0][0] : undefined;
}

function rewardTempered(player: CombatPlayer, summary: string[]): void {
  const next = Math.min(4, buffStacks(player, 'tempered') + 1); setBuff(player, 'tempered', next); player.resources.energy = resourceValue(player, 'energy') + 0.5; summary.push(`${player.nickname} 应对成功，千锤百炼提升至 ${formatLevel(next)} 层并获得 0.5 气。`);
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

function validateGridTarget(destination: number | undefined, players: ReadonlyMap<string, CombatPlayer>): void {
  const cellCount = players.size * 2;
  if (!Number.isInteger(destination) || destination! < 0 || destination! >= cellCount) throw new Error('请选择有效地块');
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
function resolutionActor(playerId: string, action: SubmittedAction) { const definition = requireAction(action.actionId); return { playerId, actionId: action.actionId, targetIds: actionTargets(action), poseId: definition.vfxId || undefined, transformCharacterId: action.transformCharacterId, power: action.power, targetGridIndex: action.targetGridIndex }; }
function describeSubmittedAction(player: CombatPlayer, action: SubmittedAction | undefined, players: ReadonlyMap<string, CombatPlayer>): string { if (!action) return `${player.nickname}：未提交`; const definition = requireAction(action.actionId); if (action.actionId === 'transform') return `${player.nickname}：变身为${characterById.get(action.transformCharacterId ?? '')?.name ?? action.transformCharacterId ?? '未知角色'}`; const targets = summarizeTargets(actionTargets(action), players); return `${player.nickname}：${definition.name}${action.power === undefined ? '' : `（n=${action.power}）`}${targets ? ` → ${targets}` : ''}`; }
function summarizeTargets(targetIds: string[], players: ReadonlyMap<string, CombatPlayer>): string {
  const counts = new Map<string, number>();
  for (const targetId of targetIds) counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  return Array.from(counts, ([targetId, count]) => `${players.get(targetId)?.nickname ?? targetId}${count > 1 ? ` ×${count}` : ''}`).join('、');
}
