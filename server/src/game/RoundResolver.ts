import { actionById, type ActionDefinition, type EffectHandlerId } from '@energy-duel/shared';

export interface CombatPlayer {
  id: string;
  nickname: string;
  resources: Record<string, number>;
  currentHp: number;
  maxHp: number;
  alive: boolean;
}

export interface SubmittedAction {
  actionId: string;
  targetId?: string;
}

export interface RoundResult {
  summary: string[];
  eliminated: string[];
}

export function validateAction(
  player: CombatPlayer,
  action: SubmittedAction,
  players: ReadonlyMap<string, CombatPlayer>,
): void {
  if (!player.alive) throw new Error('已淘汰玩家不能出招');
  const definition = requireAction(action.actionId);
  for (const [resourceId, amount] of Object.entries(definition.cost)) {
    if (resourceValue(player, resourceId) < amount) throw new Error(`${resourceId}资源不足`);
  }
  if (definition.target.mode === 'single_enemy') {
    const target = action.targetId ? players.get(action.targetId) : undefined;
    if (!target || !target.alive || target.id === player.id) throw new Error('请选择其他存活玩家作为目标');
  } else if (action.targetId) {
    throw new Error('该行动不接受单体目标');
  }
}

export function resolveRound(
  players: Map<string, CombatPlayer>,
  actions: ReadonlyMap<string, SubmittedAction>,
): RoundResult {
  const summary: string[] = [];
  const aliveAtStart = Array.from(players.values()).filter((player) => player.alive);
  const effectFor = (playerId: string) => primaryEffect(actions.get(playerId));
  const hasChop = aliveAtStart.some((player) => effectFor(player.id) === 'chop');
  const immune = new Set(aliveAtStart.filter((player) => effectFor(player.id) === 'super_defend').map((player) => player.id));
  const defended = new Set(aliveAtStart.filter((player) => effectFor(player.id) === 'defend').map((player) => player.id));
  const eliminated = new Set<string>();

  for (const player of aliveAtStart) {
    const action = actions.get(player.id);
    if (!action) continue;
    for (const [resourceId, amount] of Object.entries(requireAction(action.actionId).cost)) {
      player.resources[resourceId] = resourceValue(player, resourceId) - amount;
    }
  }

  if (hasChop) {
    const stealers = aliveAtStart.filter((player) => effectFor(player.id) === 'steal');
    for (const stealer of stealers) eliminated.add(stealer.id);
    if (stealers.length > 0) summary.push(`剁生效：${stealers.map((player) => player.nickname).join('、')} 的凹被取消并遭到淘汰。`);
    else summary.push('剁生效，但本回合无人使用凹。');
  }

  const stolenCharges = new Set<string>();
  for (const player of aliveAtStart) {
    if (effectFor(player.id) !== 'charge') continue;
    if (!hasChop) {
      const stealer = aliveAtStart.find((candidate) => {
        const action = actions.get(candidate.id);
        return effectFor(candidate.id) === 'steal' && action?.targetId === player.id && !stolenCharges.has(player.id);
      });
      if (stealer) {
        stealer.resources.energy = resourceValue(stealer, 'energy') + 1;
        stolenCharges.add(player.id);
        summary.push(`${stealer.nickname} 凹中了 ${player.nickname}，偷取 1 气。`);
        continue;
      }
    }
    player.resources.energy = resourceValue(player, 'energy') + 1;
    summary.push(`${player.nickname} 出气，获得 1 气。`);
  }

  for (const attacker of aliveAtStart) {
    const action = actions.get(attacker.id);
    if (effectFor(attacker.id) !== 'wave' || !action?.targetId) continue;
    const target = players.get(action.targetId);
    if (!target) continue;
    if (immune.has(target.id) || defended.has(target.id)) summary.push(`${target.nickname} 防住了 ${attacker.nickname} 的波。`);
    else {
      eliminated.add(target.id);
      summary.push(`${attacker.nickname} 的波命中 ${target.nickname}。`);
    }
  }

  for (const attacker of aliveAtStart) {
    if (effectFor(attacker.id) !== 'hangup') continue;
    const victims = aliveAtStart.filter((target) => target.id !== attacker.id && !immune.has(target.id));
    for (const victim of victims) eliminated.add(victim.id);
    summary.push(`${attacker.nickname} 使用挂机，命中 ${victims.length > 0 ? victims.map((player) => player.nickname).join('、') : '无人'}。`);
  }

  for (const playerId of eliminated) {
    const player = players.get(playerId);
    if (player) {
      player.alive = false;
      player.currentHp = 0;
    }
  }

  if (summary.length === 0) summary.push('本回合没有产生效果。');
  return { summary, eliminated: Array.from(eliminated) };
}

export function requireAction(actionId: string): ActionDefinition {
  const definition = actionById.get(actionId);
  if (!definition) throw new Error('未知行动');
  return definition;
}

function primaryEffect(action: SubmittedAction | undefined): EffectHandlerId | undefined {
  return action ? requireAction(action.actionId).effects[0]?.handler : undefined;
}

function resourceValue(player: CombatPlayer, resourceId: string): number {
  return player.resources[resourceId] ?? 0;
}
