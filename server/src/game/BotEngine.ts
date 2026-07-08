import { PlayerState, BotLevel } from '../../shared/types';
import { getMovesByLevel, getMoveById } from '../data/moves';

function randInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function randPick<T>(arr: T[]): T {
  return arr[randInt(arr.length)];
}

/**
 * Bot AI — chooses a move and targets.
 */
export function chooseBotMove(
  level: BotLevel,
  bot: PlayerState,
  allPlayers: PlayerState[]
): { moveId: string; targets: string[] } {
  const available = getMovesByLevel(bot.level);
  const others = allPlayers.filter(p => p.alive && p.id !== bot.id);

  if (others.length === 0) {
    return { moveId: 'yun', targets: [] };
  }

  if (level === 'easy') return easyBot(bot, available, others);
  return normalBot(bot, available, others);
}

/** Simple: random with basic survival */
function easyBot(
  bot: PlayerState,
  available: ReturnType<typeof getMovesByLevel>,
  others: PlayerState[]
): { moveId: string; targets: string[] } {
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) return { moveId: 'yun', targets: [] };

  // If targeted by 2+ enemies, try to defend
  // (bots can't know human moves, but we can guess)
  const attacks = affordable.filter(m => m.atk > 0);
  const defenses = affordable.filter(m => m.def > 0 || m.type === 'special_defense');
  const specials = affordable.filter(m => m.type === 'special');
  const charges = affordable.filter(m => m.type === 'charge');

  // 60% attack, 25% defense, 10% special, 5% charge
  const roll = Math.random();
  let pick;
  if (roll < 0.6 && attacks.length > 0) {
    pick = randPick(attacks);
  } else if (roll < 0.85 && defenses.length > 0) {
    pick = randPick(defenses);
  } else if (roll < 0.95 && specials.length > 0) {
    pick = randPick(specials);
  } else {
    pick = randPick(charges.length > 0 ? charges : affordable);
  }

  return makeTargets(pick, bot, others);
}

/** Normal: scoring heuristic */
function normalBot(
  bot: PlayerState,
  available: ReturnType<typeof getMovesByLevel>,
  others: PlayerState[]
): { moveId: string; targets: string[] } {
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) return { moveId: 'yun', targets: [] };

  // If rich (≥5 energy), prefer high-ATK finishers
  if (bot.energy >= 5) {
    const finishers = affordable.filter(m => m.atk >= 50);
    if (finishers.length > 0 && Math.random() < 0.5) {
      return makeTargets(randPick(finishers), bot, others);
    }
  }

  // Score each move
  interface Scored { move: ReturnType<typeof getMoveById>; score: number }
  if (!getMoveById) return { moveId: 'yun', targets: [] };

  const scored: { moveId: string; score: number }[] = affordable.map(m => {
    let score = 0;
    if (m.atk > 0) score += m.atk * 2;           // high ATK = good
    score -= m.cost * 5;                           // low cost = good
    if (m.def > 0) score += m.def * 1.5;          // defense has value
    if (m.type === 'charge') score += 10;          // charging is safe
    // Prefer moves that can break common defenses
    if (m.atk >= 30) score += 15;
    if (m.atk >= 50) score += 20;
    // Random noise for unpredictability
    score += Math.random() * 30;
    return { moveId: m.id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = getMoveById(scored[0].moveId);
  if (!best) return { moveId: 'yun', targets: [] };

  return makeTargets(best, bot, others);
}

/** Pick targets for a given move */
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
  // dual: 1 or 2 random targets
  const shuffled = [...others].sort(() => Math.random() - 0.5);
  const count = others.length >= 2 ? (Math.random() < 0.5 ? 1 : 2) : 1;
  return { moveId: move.id, targets: shuffled.slice(0, count).map(p => p.id) };
}
