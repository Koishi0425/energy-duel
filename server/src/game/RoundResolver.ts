import {
  actionById,
  characterById,
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
}

export interface SubmittedAction {
  actionId: string;
  targetId?: string;
  targetIds?: string[];
  transformCharacterId?: string;
  power?: number;
  targetGridIndex?: number;
  resourceSpend?: Record<string, number>;
}

export interface RoundResult {
  summary: string[];
  eliminated: string[];
  steps: ResolutionStep[];
}

export function validateAction(player: CombatPlayer, action: SubmittedAction, players: ReadonlyMap<string, CombatPlayer>): void {
  if (!player.alive) throw new Error('已淘汰玩家不能出招');
  const definition = requireAction(action.actionId);
  if (player.buffs?.has('fear') && action.actionId !== 'charge') throw new Error('恐惧期间只能使用「气」');
  const variable = definition.variable;
  if (variable) {
    if (!Number.isInteger(action.power) || (action.power ?? 0) < variable.minPower
      || (variable.maxPower !== undefined && (action.power ?? 0) > variable.maxPower)) throw new Error('请选择有效的技能参数 n');
  } else if (action.power !== undefined) throw new Error('该行动不接受参数 n');
  for (const [resourceId, amount] of Object.entries(costForSubmittedAction(player, action))) {
    if (resourceValue(player, resourceId) + 1e-6 < amount) throw new Error(`${resourceId}资源不足`);
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
  if (definition.targetsGridCell) validateAdjacentDestination(player, action.targetGridIndex, players);
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
    if (!Number.isFinite(amount) || amount < 0 || resourceValue(player, resourceId) + 1e-6 < amount) throw new Error('任意资源支付无效');
  }
}

function validateAdjacentDestination(player: CombatPlayer, destination: number | undefined, players: ReadonlyMap<string, CombatPlayer>): void {
  const cellCount = players.size * 2;
  if (!Number.isInteger(destination) || destination! < 0 || destination! >= cellCount) throw new Error('请选择相邻空地');
  const current = player.gridIndex ?? 0;
  const adjacent = destination === (current + 1) % cellCount || destination === (current - 1 + cellCount) % cellCount;
  if (!adjacent || Array.from(players.values()).some((candidate) => candidate.alive && candidate.id !== player.id && candidate.gridIndex === destination)) throw new Error('请选择相邻空地');
}

export function buildResolutionSteps(actions: ReadonlyMap<string, SubmittedAction>): ResolutionStep[] {
  const ordered = Array.from(actions.entries()).sort(([leftId, left], [rightId, right]) => {
    const speedDifference = actionSpeed(rightId, right, undefined) - actionSpeed(leftId, left, undefined);
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
    steps.push({ sequence: steps.length, speedPriority: actionSpeed(playerId, action, undefined), actors, participantIds: Array.from(new Set(actors.flatMap((actor) => [actor.playerId, ...actor.targetIds]))), durationMs: 650 });
  }
  return steps;
}

export function resolveRound(players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>): RoundResult {
  const summary: string[] = []; const eliminated = new Set<string>();
  const aliveAtStart = Array.from(players.values()).filter((player) => player.alive);
  const hpAtStart = new Map(aliveAtStart.map((player) => [player.id, player.currentHp]));
  summary.push(`本回合行动：${aliveAtStart.map((player) => describeSubmittedAction(player, actions.get(player.id), players)).join('；')}。`);

  for (const player of aliveAtStart) {
    const action = actions.get(player.id); if (!action) continue;
    if (player.buffs?.has('sleeping') && !['continue_sleep', 'filthy_bloodline'].includes(action.actionId)) wakeMudrock(player, true, summary);
    for (const [resourceId, amount] of Object.entries(costForSubmittedAction(player, action))) player.resources[resourceId] = resourceValue(player, resourceId) - amount;
    for (const [resourceId, amount] of Object.entries(action.resourceSpend ?? {})) player.resources[resourceId] = resourceValue(player, resourceId) - amount;
    if (action.actionId === 'filthy_bloodline') { setBuff(player, 'sleeping', 2); setBuff(player, 'sleep_progress', 1); }
  }

  const preprocessed = new Set<string>();
  for (const player of aliveAtStart) {
    const action = actions.get(player.id); if (!action) continue;
    if (action.actionId === 'quick_attack') { const moved = tryMove(player, action.targetGridIndex, players); setBuff(player, 'quick_attack_ready'); summary.push(moved ? `${player.nickname} 使用迅雷移动到 ${player.gridIndex} 号地块。` : `${player.nickname} 的迅雷目标格已被占用，留在原地。`); preprocessed.add(player.id); }
    if (action.actionId === 'rockfall_hammer') { player.currentHp = Math.min(player.maxHp, player.currentHp + 1); summary.push(`${player.nickname} 的岩崩锤先使其进入${healthStateName(player)}。`); }
  }

  countMudrockSelections(players, actions);
  const hasChop = aliveAtStart.some((player) => primaryEffect(actions.get(player.id)) === 'chop');
  const hasCut = aliveAtStart.some((player) => primaryEffect(actions.get(player.id)) === 'cut');
  const immune = new Set(aliveAtStart.filter((player) => primaryEffect(actions.get(player.id)) === 'super_defend').map((player) => player.id));
  const fragile = new Set(aliveAtStart.filter((player) => ['fist', 'double_steal', 'heal', 'winning_hand'].includes(primaryEffect(actions.get(player.id)) ?? '') && player.characterId !== 'mudrock').map((player) => player.id));
  const blockers = new Map(aliveAtStart.flatMap((player) => {
    const action = actions.get(player.id); return action && requireAction(action.actionId).category === 'defense' ? [[player.id, requireAction(action.actionId)]] as const : [];
  }));
  const darkShelterAbsorbs = chooseDarkShelterAbsorbs(players, actions);
  const attackAttempts = new Set<string>(); const canceledAttackTargets = new Set<string>(); const canceledActors = new Set<string>(); const processed = new Set<string>();

  if (hasChop) resolveGlobalCounter('steal', '凹', '剁', aliveAtStart, actions, eliminated, fragile, summary);
  if (hasCut) resolveGlobalCounter('absorb_charge', '吸', '削', aliveAtStart, actions, eliminated, fragile, summary);

  const chargeClaims = new Set<string>(); const absorbClaims = new Set<string>(); const preclaimedResources = new Set<string>();
  if (!hasChop) for (const actor of aliveAtStart) {
    const submitted = actions.get(actor.id); const effect = primaryEffect(submitted); if (!submitted || !['steal', 'double_steal'].includes(effect ?? '')) continue;
    for (const targetId of actionTargets(submitted)) {
      const target = players.get(targetId);
      if (primaryEffect(actions.get(targetId)) === 'charge' && !chargeClaims.has(targetId)) { chargeClaims.add(targetId); actor.resources.energy = resourceValue(actor, 'energy') + 1; preclaimedResources.add(actor.id); summary.push(`${actor.nickname} 从 ${target?.nickname ?? targetId} 偷取 1 气。`); }
      else summary.push(`${actor.nickname} 的${requireAction(submitted.actionId).name}没有从 ${target?.nickname ?? targetId} 获得气：目标本回合没有出气。`);
    }
  }
  if (!hasCut) for (const actor of aliveAtStart) {
    const submitted = actions.get(actor.id); if (!submitted || primaryEffect(submitted) !== 'absorb_charge') continue;
    const targetId = actionTargets(submitted)[0]; const target = players.get(targetId);
    if (targetId && primaryEffect(actions.get(targetId)) === 'gain_charge' && !absorbClaims.has(targetId)) { absorbClaims.add(targetId); actor.resources.charge = resourceValue(actor, 'charge') + 1; preclaimedResources.add(actor.id); summary.push(`${actor.nickname} 从 ${target?.nickname ?? targetId} 吸取 1 蓄力。`); }
    else summary.push(`${actor.nickname} 的吸没有获得蓄力。`);
  }

  const ordered = aliveAtStart.filter((player) => actions.has(player.id)).sort((left, right) => {
    const speed = actionSpeed(right.id, actions.get(right.id)!, right) - actionSpeed(left.id, actions.get(left.id)!, left);
    return speed || left.id.localeCompare(right.id);
  });
  for (const actor of ordered) {
    const submitted = actions.get(actor.id)!; const definition = requireAction(submitted.actionId); const effect = primaryEffect(submitted)!;
    if (canceledActors.has(actor.id)) { summary.push(`${actor.nickname} 的${definition.name}因恐惧未能结算。`); processed.add(actor.id); continue; }
    let gainedResource = preclaimedResources.has(actor.id);
    if (effect === 'transform') {
      const next = submitted.transformCharacterId ?? actor.characterId; actor.characterId = next; actor.currentFormId = 'base'; actor.maxHp = next === 'default_character' ? 1 : 2; actor.currentHp = actor.maxHp;
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
      if (actor.characterId === 'ao' && buffStacks(actor, 'ao_mastery') >= 4) resolveAttackTargets(actor, submitted, definition, actionTargets(submitted), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary);
    } else if (effect === 'absorb_charge' && !hasCut) {
      const targetId = actionTargets(submitted)[0]; const target = players.get(targetId);
      if (buffStacks(actor, 'ao_mastery') >= 4 && targetId) resolveAttackTargets(actor, submitted, definition, [targetId], submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary);
    } else if (effect === 'heal') { actor.currentHp = Math.min(actor.maxHp, actor.currentHp + 1); summary.push(`${actor.nickname} 使用治疗，进入${healthStateName(actor)}。`); }
    else if (effect === 'raise_axe') { setBuff(actor, 'axe_raised'); summary.push(`${actor.nickname} 举起战斧。`); }
    else if (effect === 'hidden_cache') { actor.resources.stars = resourceValue(actor, 'stars') + 1; setBuff(actor, 'hidden_cache_pending'); gainedResource = true; summary.push(`${actor.nickname} 获得 1 辉星，并将在下回合开始时再获得 3 辉星。`); }
    else if (effect === 'winning_hand') { actor.resources.stars = resourceValue(actor, 'stars') + 9; gainedResource = true; summary.push(`${actor.nickname} 获得 9 辉星。`); }
    else if (effect === 'forge_sword') summary.push(`${actor.nickname} 将君王之剑锻造至 ${formatLevel(forge(actor, 3))}。`);
    else if (effect === 'forge_wall') summary.push(`${actor.nickname} 将君王之剑锻造至 ${formatLevel(forge(actor, 1))}。`);
    else if (effect === 'summon_forth') { const level = forge(actor, 0.5); setBuff(actor, 'sovereign_blade_active'); summary.push(`${actor.nickname} 将君王之剑锻造至 ${formatLevel(level)} 并激活。`); }
    else if (effect === 'filthy_bloodline') summary.push(`${actor.nickname} 进入沉睡，无法被选中并免疫伤害。`);
    else if (effect === 'continue_sleep') { const remaining = Math.max(0, buffStacks(actor, 'sleeping') - 1); setBuff(actor, 'sleep_progress', buffStacks(actor, 'sleep_progress') + 1); if (remaining > 0) setBuff(actor, 'sleeping', remaining); else wakeMudrock(actor, false, summary); }
    else if (effect === 'shadow_blade') { resolveSpatialAttack(actor, submitted, definition, cellsAround(actor.gridIndex ?? 0, players.size * 2, 1), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary); setBuff(actor, 'shadow_blade_cooldown', 4); }
    else if (effect === 'ten_volt' || effect === 'hundred_thousand_volt') { const targets = firstPlayersInBothDirections(actor, players); resolveAttackTargets(actor, submitted, definition, targets, submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary); if (effect === 'ten_volt') removeBuff(actor, 'quick_attack_ready'); }
    else if (effect === 'dream_path') { const target = players.get(actionTargets(submitted)[0]); const start = actor.gridIndex ?? 0; const cells = target ? clockwiseCells(start, target.gridIndex ?? 0, players.size * 2) : []; resolveSpatialAttack(actor, submitted, definition, cells, players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary); if (target) { setBuff(actor, 'dream_path', (target.gridIndex ?? 0) + 1, 3); setBuff(actor, 'dream_path_start', start + 1, 3); } }
    else if (effect === 'rockfall_hammer') { resolveSpatialAttack(actor, submitted, definition, cellsAround(actor.gridIndex ?? 0, players.size * 2, 2), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary); setBuff(actor, 'hammer_ready', Math.max(0, buffStacks(actor, 'hammer_ready') - 1)); }
    else if (effect === 'haunting_shadows') { for (const player of players.values()) setBuff(player, 'darkness', 1, 2); setBuff(actor, 'nightmare_dash_ready', 1, 2); if (actionTargets(submitted).length) { resolveAttackTargets(actor, submitted, definition, actionTargets(submitted), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary); finishNightmareDash(actor, players.get(actionTargets(submitted)[0]), players); } summary.push(`${actor.nickname} 令全场陷入黑暗。`); }
    else if (effect === 'nightmare_dash') { resolveAttackTargets(actor, submitted, definition, actionTargets(submitted), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary); finishNightmareDash(actor, players.get(actionTargets(submitted)[0]), players); }
    else if (effect === 'silent_fear') {
      const targetId = actionTargets(submitted)[0]; const target = players.get(targetId); const targetAction = actions.get(targetId);
      if (target && submittedActionLevel(target, targetAction) <= submittedActionLevel(actor, submitted)) { setBuff(target, 'fear', 1, 2); if (!processed.has(targetId) && targetAction?.actionId !== 'charge') { canceledActors.add(targetId); blockers.delete(targetId); setBuff(target, 'fear_action_canceled'); } }
      resolveAttackTargets(actor, submitted, definition, targetId ? [targetId] : [], submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary);
    } else if (isDirectAttack(effect)) resolveAttackTargets(actor, submitted, definition, directTargets(actor, submitted, players), submittedActionLevel(actor, submitted), players, actions, blockers, immune, fragile, eliminated, attackAttempts, canceledAttackTargets, darkShelterAbsorbs, summary);

    if (gainedResource && actor.characterId === 'ao') setBuff(actor, 'ao_mastery', Math.min(4, buffStacks(actor, 'ao_mastery') + 1));
    if (effect === 'aoao_divine') removeBuff(actor, 'ao_mastery');
    if (effect === 'sovereign_blade') removeBuff(actor, 'sovereign_blade_active');
    if (actor.characterId === 'mudrock' && effect === 'fist') setBuff(actor, 'mud_fist_level', buffStacks(actor, 'mud_fist_level') + 1);
    if (actor.characterId === 'nightmare' && effect !== 'shadow_blade' && actor.buffs?.has('shadow_blade_cooldown')) { const next = buffStacks(actor, 'shadow_blade_cooldown') - 1; if (next > 0) setBuff(actor, 'shadow_blade_cooldown', next); else removeBuff(actor, 'shadow_blade_cooldown'); }
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
  }
  for (const id of eliminated) { const player = players.get(id); if (player) { player.alive = false; player.currentHp = 0; } }
  return { summary, eliminated: Array.from(eliminated), steps: buildResolutionSteps(actions) };
}

function resolveGlobalCounter(effectId: EffectHandlerId, targetName: string, counterName: string, players: CombatPlayer[], actions: ReadonlyMap<string, SubmittedAction>, eliminated: Set<string>, fragile: Set<string>, summary: string[]): void {
  const users = players.filter((player) => primaryEffect(actions.get(player.id)) === effectId);
  for (const user of users) { damagePlayer(user, 1, 0, fragile.has(user.id), eliminated, true, true, actions.get(user.id)); summary.push(`${user.nickname} 的${targetName}被${counterName}取消，进入${healthStateName(user)}。`); }
  if (!users.length) summary.push(`有人使用${counterName}，但本回合无人使用${targetName}。`);
}

function resolveSpatialAttack(attacker: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, cells: number[], players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[]): void {
  const targets = Array.from(players.values()).filter((target) => target.id !== attacker.id && target.alive && cells.includes(target.gridIndex ?? -1)).map((target) => target.id);
  resolveAttackTargets(attacker, submitted, definition, targets, submittedActionLevel(attacker, submitted), players, actions, blockers, immune, fragile, eliminated, attempts, canceled, shelter, summary);
}

function resolveAttackTargets(attacker: CombatPlayer, submitted: SubmittedAction, definition: ActionDefinition, targets: string[], level: number, players: Map<string, CombatPlayer>, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, attempts: Set<string>, canceled: Set<string>, shelter: Map<string, string>, summary: string[]): void {
  const allocations = new Map<string, number>();
  if (primaryEffect(submitted) === 'stardust') for (const id of targets) allocations.set(id, (allocations.get(id) ?? 0) + 0.5);
  else for (const id of new Set(targets)) allocations.set(id, level);
  for (const [targetId, attackLevel] of allocations) { attempts.add(targetId); if (applyAttack(attacker, players.get(targetId), definition, attackLevel, actions, blockers, immune, fragile, eliminated, shelter, players.size * 2, summary) === 'none') canceled.add(targetId); }
}

function applyAttack(attacker: CombatPlayer, target: CombatPlayer | undefined, attack: ActionDefinition, rawLevel: number, actions: ReadonlyMap<string, SubmittedAction>, blockers: Map<string, ActionDefinition>, immune: Set<string>, fragile: Set<string>, eliminated: Set<string>, shelter: Map<string, string>, boardCellCount: number, summary: string[]): DamageOutcome {
  if (!target) return 'none';
  if (target.buffs?.has('sleeping')) { summary.push(`${target.nickname} 在沉睡中免疫了 ${attacker.nickname} 的${attack.name}。`); return 'none'; }
  if (immune.has(target.id)) { summary.push(`${target.nickname} 的超防挡住了 ${attacker.nickname}。`); return 'none'; }
  if (shelter.get(target.id) === attacker.id) { summary.push(`${target.nickname} 的黑暗庇护吸收了 ${attacker.nickname} 的${attack.name}。`); return 'none'; }
  let attackerLevel = rawLevel + (target.buffs?.has('fear') ? 1 : 0);
  if (attacker.buffs?.has('dark_shelter_power')) attackerLevel += 0.5;
  if (attacker.buffs?.has('dream_path') && dreamPathContains(attacker, attacker.gridIndex ?? 0, boardCellCount)) attackerLevel += 0.5;
  if (target.buffs?.has('mud_barrier')) { removeBuff(target, 'mud_barrier'); target.currentHp = Math.min(target.maxHp, target.currentHp + 1); summary.push(`${target.nickname} 的屏障抵消攻击并使其进入${healthStateName(target)}。`); return 'none'; }
  const targetAction = actions.get(target.id); const block = blockers.get(target.id); let targetLevel = submittedActionLevel(target, targetAction);
  if (primaryEffect(targetAction) === 'dark_shelter') targetLevel = 0;
  if (block && attackerLevel < targetLevel) { summary.push(`${target.nickname} 的${block.name}挡住了 ${attacker.nickname} 的${attack.name}。`); return 'none'; }
  if (block?.effects[0]?.handler === 'axe_defend') target.resources.energy = resourceValue(target, 'energy') + 1;
  const outcome = damagePlayer(target, attackerLevel, targetLevel, fragile.has(target.id), eliminated, false, attackerLevel < 3, targetAction);
  const comparison = `${attacker.nickname} 的${attack.name}（${formatLevel(attackerLevel)}级）对 ${target.nickname} 的${targetAction ? requireAction(targetAction.actionId).name : '无招式'}（${formatLevel(targetLevel)}级）`;
  if (outcome === 'none') summary.push(`${comparison}：等级差不足 0.5，攻击被抵消。`);
  else summary.push(`${comparison}：等级差 ${formatLevel(attackerLevel - targetLevel)}，${target.nickname} 进入${healthStateName(target)}。`);
  return outcome;
}

type DamageOutcome = 'none' | 'shifted' | 'shifted_out' | 'eliminated';
function damagePlayer(player: CombatPlayer, attackLevel: number, defenseLevel: number, isFragile: boolean, eliminated: Set<string>, forceShift = false, maxOneState = false, selected?: SubmittedAction): DamageOutcome {
  const difference = attackLevel - defenseLevel; const mudFistRisk = player.characterId === 'mudrock' && selected?.actionId === 'fist' && difference >= 0.5;
  if ((isFragile && (forceShift || difference >= 0.5)) || mudFistRisk) { player.currentHp = 0; eliminated.add(player.id); return 'eliminated'; }
  if (!maxOneState && difference >= 1) { player.currentHp = 0; eliminated.add(player.id); return 'eliminated'; }
  if (forceShift || difference >= 0.5) { player.currentHp -= 1; if (player.currentHp <= 0) { eliminated.add(player.id); return 'shifted_out'; } player.resources.energy = resourceValue(player, 'energy') + 1; return 'shifted'; }
  return 'none';
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
    const incoming = Array.from(actions.entries()).filter(([id, action]) => id !== target.id && requireAction(action.actionId).category === 'attack' && potentialTargets(players.get(id)!, action, players).includes(target.id))
      .sort(([leftId, left], [rightId, right]) => submittedActionLevel(players.get(rightId)!, right) - submittedActionLevel(players.get(leftId)!, left));
    if (incoming[0]) result.set(target.id, incoming[0][0]);
  }
  return result;
}

function potentialTargets(actor: CombatPlayer, action: SubmittedAction, players: Map<string, CombatPlayer>): string[] {
  const effect = primaryEffect(action); const count = players.size * 2;
  if (effect === 'ten_volt' || effect === 'hundred_thousand_volt') return firstPlayersInBothDirections(actor, players);
  if (effect === 'shadow_blade') return playersOnCells(actor, cellsAround(actor.gridIndex ?? 0, count, 1), players);
  if (effect === 'rockfall_hammer') return playersOnCells(actor, cellsAround(actor.gridIndex ?? 0, count, 2), players);
  if (effect === 'dream_path') { const target = players.get(actionTargets(action)[0]); return target ? playersOnCells(actor, clockwiseCells(actor.gridIndex ?? 0, target.gridIndex ?? 0, count), players) : []; }
  if (effect === 'hangup') return Array.from(players.values()).filter((target) => target.alive && target.id !== actor.id).map((target) => target.id);
  return actionTargets(action);
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
function isDirectAttack(effect: EffectHandlerId): boolean { return ['wave', 'fist', 'slash', 'atomic_breath', 'sovereign_blade', 'stardust', 'hangup', 'sword_aura', 'open_heaven_gate', 'aoao_divine'].includes(effect); }
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
function forge(player: CombatPlayer, amount: number): number { const previous = buffStacks(player, 'sovereign_blade_forged'); const next = Math.min(3, previous + amount); setBuff(player, 'sovereign_blade_forged', next); if (previous === 0) setBuff(player, 'sovereign_blade_active'); return next; }

function submittedActionLevel(player: CombatPlayer, action: SubmittedAction | undefined): number {
  if (!action || player.buffs?.has('fear_action_canceled')) return 0; const definition = requireAction(action.actionId); let level = definition.variable && action.power !== undefined ? definition.variable.levelPerPower * action.power : definition.level;
  if (definition.id === 'slash' && player.buffs?.has('axe_raised')) level += 0.5;
  if (definition.id === 'slash' && player.characterId === 'mudrock') level += buffStacks(player, 'mud_awakened');
  if (definition.id === 'fist' && player.characterId === 'mudrock') level += buffStacks(player, 'mud_fist_level') * 0.5;
  if (['steal', 'absorb_charge'].includes(definition.id) && player.characterId === 'ao') { const stage = buffStacks(player, 'ao_mastery'); level = (stage >= 1 ? 0.5 : 0) + (stage >= 3 ? 1 : 0); }
  if (definition.id === 'aoao_divine') level += buffStacks(player, 'ao_mastery') * 0.5;
  if (primaryEffect(action) === 'sovereign_blade') level = Math.min(3, buffStacks(player, 'sovereign_blade_forged'));
  if (player.buffs?.has('iridescence_afterglow')) level = Math.max(1.5, level);
  return level;
}

function costForSubmittedAction(player: CombatPlayer, action: SubmittedAction): Record<string, number> {
  if (action.actionId === 'transform' && action.transformCharacterId) return characterById.get(action.transformCharacterId)?.transformationCost ?? {};
  const definition = requireAction(action.actionId); const cost = { ...definition.cost };
  if (action.actionId === 'slash' && player.characterId === 'li_chungang') cost.energy = 1 / 3;
  if (action.actionId === 'ten_volt' && player.buffs?.has('quick_attack_ready')) cost.charge = 0;
  if (definition.variable && action.power !== undefined) cost[definition.variable.resourceId] = (cost[definition.variable.resourceId] ?? 0) + definition.variable.costPerPower * action.power;
  return cost;
}

function actionSpeed(playerId: string, action: SubmittedAction, player: CombatPlayer | undefined): number { return requireAction(action.actionId).speedPriority + (player?.buffs?.has('dark_shelter_power') ? 1 : 0); }
function formatLevel(value: number): string { if (Math.abs(value - 1 / 3) < 1e-6) return '1/3'; return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function healthStateName(player: CombatPlayer): string { if (!player.alive || player.currentHp <= 0) return '死亡状态'; if (player.maxHp > 1 && player.currentHp === 1) return '濒死状态'; return '健康状态'; }
function resolutionActor(playerId: string, action: SubmittedAction) { const definition = requireAction(action.actionId); return { playerId, actionId: action.actionId, targetIds: actionTargets(action), poseId: definition.vfxId || undefined, transformCharacterId: action.transformCharacterId, power: action.power, targetGridIndex: action.targetGridIndex }; }
function describeSubmittedAction(player: CombatPlayer, action: SubmittedAction | undefined, players: ReadonlyMap<string, CombatPlayer>): string { if (!action) return `${player.nickname}：未提交`; const definition = requireAction(action.actionId); if (action.actionId === 'transform') return `${player.nickname}：变身为${characterById.get(action.transformCharacterId ?? '')?.name ?? action.transformCharacterId ?? '未知角色'}`; const targets = actionTargets(action).map((id) => players.get(id)?.nickname ?? id); return `${player.nickname}：${definition.name}${action.power === undefined ? '' : `（n=${action.power}）`}${targets.length ? ` → ${targets.join('、')}` : ''}`; }
