import { PlayerState, BotLevel } from '../../shared/types';
import { getMovesByLevel, getMoveById } from '../data/moves';

export interface BotMemory {
  consecutiveDefenses: number;
}

function randInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function randPick<T>(arr: T[]): T {
  return arr[randInt(arr.length)];
}

export function createBotMemory(): BotMemory {
  return { consecutiveDefenses: 0 };
}

export function chooseBotMove(
  level: BotLevel,
  bot: PlayerState,
  allPlayers: PlayerState[],
  round: number,
  memory: BotMemory
): { moveId: string; targets: string[] } {
  const available = getMovesByLevel(bot.level);
  const others = allPlayers.filter(p => p.alive && p.id !== bot.id);

  if (others.length === 0) {
    return { moveId: 'yun', targets: [] };
  }

  if (level === 'easy') return easyBot(bot, available, others, memory);
  return normalBot(bot, available, others, round);
}

/** Simple: random with basic survival, no 3 consecutive defenses */
function easyBot(
  bot: PlayerState,
  available: ReturnType<typeof getMovesByLevel>,
  others: PlayerState[],
  memory: BotMemory
): { moveId: string; targets: string[] } {
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) {
    memory.consecutiveDefenses = 0;
    return { moveId: 'yun', targets: [] };
  }

  const attacks = affordable.filter(m => m.atk > 0);
  const defenses = affordable.filter(m => m.def > 0 || m.type === 'special_defense');
  const specials = affordable.filter(m => m.type === 'special');
  const charges = affordable.filter(m => m.type === 'charge');

  // If already defended 2x in a row, force non-defense
  const forceNoDefense = memory.consecutiveDefenses >= 2 && (attacks.length > 0 || charges.length > 0);

  // Weights: 60% attack, 25% defense, 10% special, 5% charge
  const roll = Math.random();
  let pick;

  if (forceNoDefense) {
    pick = randPick(attacks.length > 0 ? attacks : affordable.filter(m => !(m.def > 0)));
    memory.consecutiveDefenses = 0;
  } else if (roll < 0.6 && attacks.length > 0) {
    pick = randPick(attacks);
    memory.consecutiveDefenses = 0;
  } else if (roll < 0.85 && defenses.length > 0) {
    pick = randPick(defenses);
    memory.consecutiveDefenses++;
  } else if (roll < 0.95 && specials.length > 0) {
    pick = randPick(specials);
    memory.consecutiveDefenses = 0;
  } else {
    pick = randPick(charges.length > 0 ? charges : affordable);
    memory.consecutiveDefenses = 0;
  }

  return makeTargets(pick, bot, others);
}

/** Normal: scoring heuristic. Round 1 only 运/欧/跺 */
function normalBot(
  bot: PlayerState,
  available: ReturnType<typeof getMovesByLevel>,
  others: PlayerState[],
  round: number
): { moveId: string; targets: string[] } {
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) return { moveId: 'yun', targets: [] };

  // Round 1: only 运, 欧, 跺
  if (round === 1) {
    const r1Moves = affordable.filter(m => ['yun', 'ou', 'duo'].includes(m.id));
    if (r1Moves.length > 0) {
      const pick = randPick(r1Moves);
      return makeTargets(pick, bot, others);
    }
    return { moveId: 'yun', targets: [] };
  }

  // If rich (≥5 energy), prefer high-ATK finishers
  if (bot.energy >= 5) {
    const finishers = affordable.filter(m => m.atk >= 50);
    if (finishers.length > 0 && Math.random() < 0.5) {
      return makeTargets(randPick(finishers), bot, others);
    }
  }

  // Score each move
  const scored: { moveId: string; score: number }[] = affordable.map(m => {
    let score = 0;
    if (m.atk > 0) score += m.atk * 2;
    score -= m.cost * 5;
    if (m.def > 0) score += m.def * 1.5;
    if (m.type === 'charge') score += 10;
    if (m.atk >= 30) score += 15;
    if (m.atk >= 50) score += 20;
    score += Math.random() * 30;
    return { moveId: m.id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = getMoveById(scored[0].moveId);
  if (!best) return { moveId: 'yun', targets: [] };

  return makeTargets(best, bot, others);
}

function makeTargets(
  move: NonNullable<ReturnType<typeof getMoveById>>,
  bot: PlayerState,
  others: PlayerState[]
): { moveId: string; targets: string[] } {
  if (move.targetType === 'none' || move.targetType === 'all') {
    return { moveId: move.id, targets: [] };
  }
  if (move.targetType === 'single') {
    return { moveId: move.id, targets: [randPick(others).id] };
  }
  const shuffled = [...others].sort(() => Math.random() - 0.5);
  const count = others.length >= 2 ? (Math.random() < 0.5 ? 1 : 2) : 1;
  return { moveId: move.id, targets: shuffled.slice(0, count).map(p => p.id) };
}
