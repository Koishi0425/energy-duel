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
  characterId?: string;
  currentFormId?: string;
  buffs?: Set<string>;
  buffStacks?: Record<string, number>;
}

export interface SubmittedAction {
  actionId: string;
  targetId?: string;
  targetIds?: string[];
  transformCharacterId?: string;
  power?: number;
}

export interface RoundResult {
  summary: string[];
  eliminated: string[];
  steps: ResolutionStep[];
}

export function validateAction(
  player: CombatPlayer,
  action: SubmittedAction,
  players: ReadonlyMap<string, CombatPlayer>,
): void {
  if (!player.alive) throw new Error('已淘汰玩家不能出招');
  const definition = requireAction(action.actionId);
  const variable = definition.variable;
  if (variable) {
    if (!Number.isInteger(action.power) || (action.power ?? 0) < variable.minPower
      || (variable.maxPower !== undefined && (action.power ?? 0) > variable.maxPower)) {
      throw new Error('请选择有效的技能参数 n');
    }
  } else if (action.power !== undefined) throw new Error('该行动不接受参数 n');
  for (const [resourceId, amount] of Object.entries(costForSubmittedAction(action))) {
    if (resourceValue(player, resourceId) < amount) throw new Error(`${resourceId}资源不足`);
  }
  const targets = actionTargets(action);
  const deferredPending = definition.target.selectionTiming === 'deferred' && targets.length === 0;
  if (definition.target.mode === 'single_enemy') {
    if (targets.length !== 1) throw new Error('请选择其他存活玩家作为目标');
  } else if (definition.target.mode === 'multiple_enemies') {
    const expected = definition.target.maxTargetsByPower ? action.power : definition.target.maxTargets;
    if (!deferredPending && targets.length !== expected) throw new Error(`请选择 ${expected} 次目标`);
  } else if (targets.length > 0) {
    throw new Error('该行动不接受单体目标');
  }
  for (const targetId of targets) {
    const target = players.get(targetId);
    if (!target || !target.alive || target.id === player.id) throw new Error('请选择其他存活玩家作为目标');
  }
}

export function buildResolutionSteps(actions: ReadonlyMap<string, SubmittedAction>): ResolutionStep[] {
  const ordered = Array.from(actions.entries()).sort(([leftId, left], [rightId, right]) => {
    const speedDifference = requireAction(right.actionId).speedPriority - requireAction(left.actionId).speedPriority;
    return speedDifference || leftId.localeCompare(rightId);
  });
  const used = new Set<string>();
  const steps: ResolutionStep[] = [];
  for (const [playerId, action] of ordered) {
    if (used.has(playerId)) continue;
    const definition = requireAction(action.actionId);
    const actors = [resolutionActor(playerId, action)];
    const primaryTarget = actors[0].targetIds[0];
    let partnerId: string | undefined;
    if (primaryTarget && !used.has(primaryTarget)) {
      const reply = actions.get(primaryTarget);
      if (reply && (actionTargets(reply).includes(playerId) || actionTargets(reply).length === 0)) {
        partnerId = primaryTarget;
      }
    }
    if (!partnerId && actors[0].targetIds.length === 0) {
      partnerId = ordered.find(([candidateId, candidateAction]) => candidateId !== playerId
        && !used.has(candidateId)
        && actionTargets(candidateAction).includes(playerId))?.[0];
    }
    if (!partnerId && actors[0].targetIds.length === 0) {
      partnerId = ordered.find(([candidateId, candidateAction]) => candidateId !== playerId
        && !used.has(candidateId)
        && requireAction(candidateAction.actionId).speedPriority === definition.speedPriority)?.[0];
    }
    if (partnerId) {
      actors.push(resolutionActor(partnerId, actions.get(partnerId)!));
      used.add(partnerId);
    }
    used.add(playerId);
    const participantIds = Array.from(new Set(actors.flatMap((actor) => [actor.playerId, ...actor.targetIds])));
    steps.push({ sequence: steps.length, speedPriority: definition.speedPriority, actors, participantIds, durationMs: 650 });
  }
  return steps;
}

export function resolveRound(
  players: Map<string, CombatPlayer>,
  actions: ReadonlyMap<string, SubmittedAction>,
): RoundResult {
  const summary: string[] = [];
  const aliveAtStart = Array.from(players.values()).filter((player) => player.alive);
  const hpAtStart = new Map(aliveAtStart.map((player) => [player.id, player.currentHp]));
  summary.push(`本回合行动：${aliveAtStart.map((player) => describeSubmittedAction(player, actions.get(player.id), players)).join('；')}。`);
  const effectFor = (playerId: string) => primaryEffect(actions.get(playerId));
  const hasChop = aliveAtStart.some((player) => effectFor(player.id) === 'chop');
  const immune = new Set(aliveAtStart.filter((player) => effectFor(player.id) === 'super_defend').map((player) => player.id));
  const blockers = new Map(aliveAtStart.flatMap((player) => {
    const action = actions.get(player.id);
    return action && requireAction(action.actionId).category === 'defense'
      ? [[player.id, requireAction(action.actionId)]] as const
      : [];
  }));
  const fragile = new Set(aliveAtStart.filter((player) => ['fist', 'double_steal', 'heal', 'winning_hand'].includes(effectFor(player.id) ?? '')).map((player) => player.id));
  const eliminated = new Set<string>();
  const canceledAttackTargets = new Set<string>();

  for (const player of aliveAtStart) {
    const action = actions.get(player.id);
    if (!action) continue;
    for (const [resourceId, amount] of Object.entries(costForSubmittedAction(action))) {
      player.resources[resourceId] = resourceValue(player, resourceId) - amount;
    }
  }

  if (hasChop) {
    const stealers = aliveAtStart.filter((player) => ['steal', 'double_steal'].includes(effectFor(player.id) ?? ''));
    for (const stealer of stealers) {
      damagePlayer(stealer, 1, 0, fragile.has(stealer.id), eliminated, true, true);
      summary.push(`${stealer.nickname} 的凹被剁取消，${stealer.nickname} 进入${healthStateName(stealer)}。`);
    }
    const choppers = aliveAtStart.filter((player) => effectFor(player.id) === 'chop').map((player) => player.nickname).join('、');
    if (!stealers.length) summary.push(`${choppers} 使用剁，但本回合无人使用凹。`);
  }

  const chargeClaims = new Map<string, number>();
  if (!hasChop) {
    for (const stealer of aliveAtStart) {
      if (!['steal', 'double_steal'].includes(effectFor(stealer.id) ?? '')) continue;
      for (const targetId of actionTargets(actions.get(stealer.id)!)) {
        const target = players.get(targetId);
        if (effectFor(targetId) !== 'charge') {
          summary.push(`${stealer.nickname} 的${requireAction(actions.get(stealer.id)!.actionId).name}没有从 ${target?.nickname ?? targetId} 获得气：目标本回合没有出气。`);
          continue;
        }
        const claimed = chargeClaims.get(targetId) ?? 0;
        if (claimed >= 1) {
          summary.push(`${stealer.nickname} 的${requireAction(actions.get(stealer.id)!.actionId).name}没有从 ${target?.nickname ?? targetId} 获得气：该气已被偷取。`);
          continue;
        }
        chargeClaims.set(targetId, claimed + 1);
        stealer.resources.energy = resourceValue(stealer, 'energy') + 1;
        summary.push(`${stealer.nickname} 的${requireAction(actions.get(stealer.id)!.actionId).name}从 ${target?.nickname ?? targetId} 偷取 1 气。`);
      }
    }
  }
  for (const player of aliveAtStart) {
    const effect = effectFor(player.id);
    if (effect === 'charge') {
      if (!chargeClaims.has(player.id)) {
        player.resources.energy = resourceValue(player, 'energy') + 1;
        summary.push(`${player.nickname} 使用气，获得 1 气。`);
      } else summary.push(`${player.nickname} 使用气，但产生的 1 气被偷取。`);
    } else if (effect === 'gain_charge') {
      player.resources.charge = resourceValue(player, 'charge') + 1;
      summary.push(`${player.nickname} 获得 1 蓄力。`);
    } else if (effect === 'heal') {
      player.currentHp = Math.min(player.maxHp, player.currentHp + 1);
      summary.push(`${player.nickname} 使用治疗，进入${healthStateName(player)}。`);
    } else if (effect === 'raise_axe') {
      setBuff(player, 'axe_raised');
      summary.push(`${player.nickname} 举起战斧。`);
    } else if (effect === 'hidden_cache') {
      player.resources.stars = resourceValue(player, 'stars') + 1;
      setBuff(player, 'hidden_cache_pending');
      summary.push(`${player.nickname} 使用隐秘藏品，获得 1 辉星，并将在下回合开始时再获得 3 辉星。`);
    } else if (effect === 'winning_hand') {
      player.resources.stars = resourceValue(player, 'stars') + 9;
      summary.push(`${player.nickname} 使用胜券在王，获得 9 辉星。`);
    } else if (effect === 'forge_sword') {
      const level = forge(player, 3);
      summary.push(`${player.nickname} 使用铸剑者，君王之剑锻造至 ${formatLevel(level)}。`);
    } else if (effect === 'forge_wall') {
      const level = forge(player, 1);
      summary.push(`${player.nickname} 使用筑墙，君王之剑锻造至 ${formatLevel(level)}。`);
    } else if (effect === 'summon_forth') {
      const level = forge(player, 0.5);
      setBuff(player, 'sovereign_blade_active');
      summary.push(`${player.nickname} 征召君王之剑上前，锻造提升至 ${formatLevel(level)} 并重新激活。`);
    } else if (effect === 'transform') {
      player.characterId = actions.get(player.id)?.transformCharacterId ?? player.characterId;
      player.currentFormId = 'base';
      player.maxHp = player.characterId === 'default_character' ? 1 : 2;
      player.currentHp = player.maxHp;
      if (player.characterId === 'regent' && !player.buffs?.has('regent_claimed')) {
        player.resources.stars = resourceValue(player, 'stars') + 3;
        setBuff(player, 'regent_claimed');
        summary.push(`${player.nickname} 首次成为储君，获得 3 辉星。`);
      }
      summary.push(`${player.nickname} 变身为${characterById.get(player.characterId ?? '')?.name ?? player.characterId}。`);
    }
  }

  const attackAttempts = new Set<string>();
  for (const attacker of aliveAtStart) {
    const submitted = actions.get(attacker.id);
    if (!submitted) continue;
    const definition = requireAction(submitted.actionId);
    const effect = primaryEffect(submitted);
    if (!['wave', 'fist', 'slash', 'atomic_breath', 'sovereign_blade'].includes(effect ?? '')) continue;
    for (const targetId of new Set(actionTargets(submitted))) {
      attackAttempts.add(targetId);
      const outcome = applyAttack(attacker, players.get(targetId), definition, submittedActionLevel(attacker, submitted), actions, blockers, immune, fragile, eliminated, summary);
      if (outcome === 'none') canceledAttackTargets.add(targetId);
    }
    if (effect === 'sovereign_blade') removeBuff(attacker, 'sovereign_blade_active');
  }

  for (const attacker of aliveAtStart) {
    const submitted = actions.get(attacker.id);
    if (!submitted || effectFor(attacker.id) !== 'stardust') continue;
    const allocations = new Map<string, number>();
    for (const targetId of actionTargets(submitted)) allocations.set(targetId, (allocations.get(targetId) ?? 0) + 0.5);
    const definition = requireAction(submitted.actionId);
    for (const [targetId, level] of allocations) {
      attackAttempts.add(targetId);
      const outcome = applyAttack(attacker, players.get(targetId), definition, level, actions, blockers, immune, fragile, eliminated, summary);
      if (outcome === 'none') canceledAttackTargets.add(targetId);
    }
  }

  for (const attacker of aliveAtStart) {
    if (effectFor(attacker.id) !== 'hangup') continue;
    const definition = requireAction(actions.get(attacker.id)!.actionId);
    const possibleVictims = aliveAtStart.filter((target) => target.id !== attacker.id);
    for (const target of possibleVictims) attackAttempts.add(target.id);
    const victims = possibleVictims.filter((target) => !immune.has(target.id));
    for (const victim of victims) {
      damagePlayer(victim, definition.level, 0, fragile.has(victim.id), eliminated, true);
      summary.push(`${attacker.nickname} 的挂机命中 ${victim.nickname}，${victim.nickname} 进入${healthStateName(victim)}。`);
    }
    for (const protectedPlayer of possibleVictims.filter((target) => immune.has(target.id))) summary.push(`${protectedPlayer.nickname} 的超防免疫了 ${attacker.nickname} 的挂机。`);
    summary.push(`${attacker.nickname} 使用挂机，命中 ${victims.length ? victims.map((player) => player.nickname).join('、') : '无人'}。`);
  }

  for (const player of aliveAtStart) {
    const effect = effectFor(player.id);
    if (['defend', 'axe_defend', 'super_defend'].includes(effect ?? '') && !attackAttempts.has(player.id)) {
      const definition = requireAction(actions.get(player.id)!.actionId);
      summary.push(`${player.nickname} 使用${definition.name}（${definition.level >= 999 ? '∞' : formatLevel(definition.level)}级），但本回合没有受到攻击。`);
    }
  }

  for (const player of aliveAtStart) {
    const effect = effectFor(player.id);
    if (effect === 'collect_light' && canceledAttackTargets.has(player.id) && player.currentHp === hpAtStart.get(player.id) && !eliminated.has(player.id)) {
      player.resources.stars = resourceValue(player, 'stars') + 1;
      summary.push(`${player.nickname} 的收集光辉完全抵消了攻击且没有受到伤害，获得 1 辉星。`);
    }
    removeBuff(player, 'iridescence_afterglow');
    if (effect === 'iridescence') {
      setBuff(player, 'iridescence_afterglow');
      summary.push(`${player.nickname} 获得流光余辉，下回合自身招式等级最低视为 1.5。`);
    }
  }

  for (const playerId of eliminated) {
    const player = players.get(playerId);
    if (player) { player.alive = false; player.currentHp = 0; }
  }
  if (summary.length === 0) summary.push('本回合没有产生效果。');
  return { summary, eliminated: Array.from(eliminated), steps: buildResolutionSteps(actions) };
}

function applyAttack(
  attacker: CombatPlayer,
  target: CombatPlayer | undefined,
  attack: ActionDefinition,
  attackerLevel: number,
  actions: ReadonlyMap<string, SubmittedAction>,
  blockers: Map<string, ActionDefinition>,
  immune: Set<string>,
  fragile: Set<string>,
  eliminated: Set<string>,
  summary: string[],
): DamageOutcome {
  if (!target) return 'none';
  if (immune.has(target.id)) { summary.push(`${target.nickname} 的超防挡住了 ${attacker.nickname}。`); return 'none'; }
  const block = blockers.get(target.id);
  const targetAction = actions.get(target.id);
  const targetDefinition = targetAction ? requireAction(targetAction.actionId) : undefined;
  const targetLevel = submittedActionLevel(target, targetAction);
  if (block && attackerLevel < targetLevel) {
    summary.push(`${target.nickname} 的${targetDefinition?.name ?? '格挡'}（${targetLevel}级）挡住了 ${attacker.nickname} 的${attack.name}（${attackerLevel}级）。`);
    return 'none';
  }
  if (block?.effects[0]?.handler === 'axe_defend') target.resources.energy = resourceValue(target, 'energy') + 1;
  const outcome = damagePlayer(target, attackerLevel, targetLevel, fragile.has(target.id), eliminated, false, attackerLevel < 3);
  const comparison = `${attacker.nickname} 的${attack.name}（${attackerLevel}级）对 ${target.nickname} 的${targetDefinition?.name ?? '无招式'}（${targetLevel}级）`;
  if (outcome === 'eliminated') summary.push(`${comparison}：等级差 ${formatLevel(attackerLevel - targetLevel)}，${target.nickname} 进入死亡状态。`);
  else if (outcome === 'shifted_out' || outcome === 'shifted') summary.push(`${comparison}：等级差 ${formatLevel(attackerLevel - targetLevel)}，${target.nickname} 进入${healthStateName(target)}。`);
  else summary.push(`${comparison}：等级差不足 0.5，攻击被抵消。`);
  return outcome;
}

type DamageOutcome = 'none' | 'shifted' | 'shifted_out' | 'eliminated';

function damagePlayer(player: CombatPlayer, attackLevel: number, defenseLevel: number, isFragile: boolean, eliminated: Set<string>, forceShift = false, maxOneState = false): DamageOutcome {
  const difference = attackLevel - defenseLevel;
  if (isFragile && (forceShift || difference >= 0.5)) { player.currentHp = 0; eliminated.add(player.id); return 'eliminated'; }
  if (!maxOneState && difference >= 1) { player.currentHp = 0; eliminated.add(player.id); return 'eliminated'; }
  if (forceShift || difference >= 0.5) {
    player.currentHp -= 1;
    if (player.currentHp <= 0) { eliminated.add(player.id); return 'shifted_out'; }
    else player.resources.energy = resourceValue(player, 'energy') + 1;
    return 'shifted';
  }
  return 'none';
}

function formatLevel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function healthStateName(player: CombatPlayer): string {
  if (!player.alive || player.currentHp <= 0) return '死亡状态';
  if (player.maxHp > 1 && player.currentHp === 1) return '濒死状态';
  return '健康状态';
}

function resolutionActor(playerId: string, action: SubmittedAction) {
  const definition = requireAction(action.actionId);
  return {
    playerId,
    actionId: action.actionId,
    targetIds: actionTargets(action),
    poseId: definition.vfxId || undefined,
    transformCharacterId: action.transformCharacterId,
    power: action.power,
  };
}

export function requireAction(actionId: string): ActionDefinition {
  const definition = actionById.get(actionId);
  if (!definition) throw new Error('未知行动');
  return definition;
}

function primaryEffect(action: SubmittedAction | undefined): EffectHandlerId | undefined {
  return action ? requireAction(action.actionId).effects[0]?.handler : undefined;
}

function actionTargets(action: SubmittedAction): string[] {
  return action.targetIds ?? (action.targetId ? [action.targetId] : []);
}

function resourceValue(player: CombatPlayer, resourceId: string): number {
  return player.resources[resourceId] ?? 0;
}

function buffStacks(player: CombatPlayer, buffId: string): number {
  if (!player.buffs?.has(buffId)) return 0;
  return player.buffStacks?.[buffId] ?? 1;
}

function setBuff(player: CombatPlayer, buffId: string, stacks = 1): void {
  player.buffs ??= new Set();
  player.buffStacks ??= {};
  player.buffs.add(buffId);
  player.buffStacks[buffId] = stacks;
}

function removeBuff(player: CombatPlayer, buffId: string): void {
  player.buffs?.delete(buffId);
  if (player.buffStacks) delete player.buffStacks[buffId];
}

function forge(player: CombatPlayer, amount: number): number {
  const previous = buffStacks(player, 'sovereign_blade_forged');
  const next = Math.min(3, previous + amount);
  setBuff(player, 'sovereign_blade_forged', next);
  if (previous === 0) setBuff(player, 'sovereign_blade_active');
  return next;
}

function submittedActionLevel(player: CombatPlayer, action: SubmittedAction | undefined): number {
  if (!action) return 0;
  const definition = requireAction(action.actionId);
  let level = definition.variable && action.power !== undefined
    ? definition.variable.levelPerPower * action.power
    : definition.level;
  if (definition.id === 'slash' && player.buffs?.has('axe_raised')) level += 0.5;
  if (definition.effects[0]?.handler === 'sovereign_blade') level = Math.min(3, buffStacks(player, 'sovereign_blade_forged'));
  if (player.buffs?.has('iridescence_afterglow')) level = Math.max(1.5, level);
  return level;
}

function costForSubmittedAction(action: SubmittedAction): Record<string, number> {
  if (action.actionId === 'transform' && action.transformCharacterId) return characterById.get(action.transformCharacterId)?.transformationCost ?? {};
  const definition = requireAction(action.actionId);
  const cost = { ...definition.cost };
  if (definition.variable && action.power !== undefined) {
    cost[definition.variable.resourceId] = (cost[definition.variable.resourceId] ?? 0) + definition.variable.costPerPower * action.power;
  }
  return cost;
}

function describeSubmittedAction(player: CombatPlayer, action: SubmittedAction | undefined, players: ReadonlyMap<string, CombatPlayer>): string {
  if (!action) return `${player.nickname}：未提交`;
  const definition = requireAction(action.actionId);
  if (action.actionId === 'transform') return `${player.nickname}：变身为${characterById.get(action.transformCharacterId ?? '')?.name ?? action.transformCharacterId ?? '未知角色'}`;
  const targets = actionTargets(action).map((id) => players.get(id)?.nickname ?? id);
  const power = action.power === undefined ? '' : `（n=${action.power}）`;
  return `${player.nickname}：${definition.name}${power}${targets.length ? ` → ${targets.join('、')}` : ''}`;
}
