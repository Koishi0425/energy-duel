import { PlayerState, BotLevel, MoveDef } from '../../shared/types';
import { getMovesByLevel, getMoveById } from '../data/moves';

// ---- Types ----
export interface BotMemory {
  consecutiveDefenses: number;
  opponentHistory: Map<string, string[]>;   // opponentId → last 5 moveIds
  personality: 'aggressive' | 'balanced' | 'conservative';
}

type ScoredMove = { move: MoveDef; score: number };

// ---- Utils ----
function randInt(max: number): number { return Math.floor(Math.random() * max); }
function randPick<T>(arr: T[]): T { return arr[randInt(arr.length)]; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function noise(scale: number) { return (Math.random() - 0.5) * 2 * scale; }

export function createBotMemory(): BotMemory {
  const personalities: BotMemory['personality'][] = ['aggressive', 'balanced', 'conservative'];
  return {
    consecutiveDefenses: 0,
    opponentHistory: new Map(),
    personality: randPick(personalities),
  };
}

// ================================================================
// Main entry
// ================================================================
export function chooseBotMove(
  level: BotLevel,
  bot: PlayerState,
  allPlayers: PlayerState[],
  round: number,
  memory: BotMemory
): { moveId: string; targets: string[] } {
  const available = getMovesByLevel(bot.level);
  const others = allPlayers.filter(p => p.alive && p.id !== bot.id);
  if (others.length === 0) return { moveId: 'yun', targets: [] };

  if (level === 'easy') return easyBot(bot, available, others, round, memory);
  return normalBot(bot, available, others, round, memory);
}

// ================================================================
// EASY — tendency stats + weighted random, no deep modeling
// ================================================================
function easyBot(
  bot: PlayerState, available: MoveDef[], others: PlayerState[],
  round: number, memory: BotMemory
): { moveId: string; targets: string[] } {
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) { memory.consecutiveDefenses = 0; return { moveId: 'yun', targets: [] }; }

  // Build tendency from opponent history (simple frequency)
  const tendencies = getOpponentTendencies(memory, others);
  const oppAtkRate = tendencies.attack;   // how often opponents attack
  const oppDefRate = tendencies.defense;

  // No 3 consecutive defenses
  const forceNoDef = memory.consecutiveDefenses >= 2;

  const attacks = affordable.filter(m => m.atk > 0);
  const defenses = affordable.filter(m => m.def > 0 || m.type === 'special_defense');
  const specials = affordable.filter(m => m.type === 'special');
  const charges = affordable.filter(m => m.type === 'charge');

  // Dynamic weights based on opponent tendencies + personality
  let atkW = 50, defW = 25, spW = 15, chW = 10;

  // If opponents attack a lot → defend more
  if (oppAtkRate > 0.5) { defW += 20; atkW -= 15; }
  // If opponents defend a lot → charge more (don't waste attacks)
  if (oppDefRate > 0.4) { chW += 15; atkW -= 10; }
  // Personality
  if (memory.personality === 'aggressive') { atkW += 15; defW -= 10; }
  if (memory.personality === 'conservative') { defW += 15; atkW -= 10; }

  if (forceNoDef) { defW = 0; atkW += 20; }

  const totalW = atkW + defW + spW + chW;
  const roll = Math.random() * totalW;
  let pick: MoveDef;

  if (roll < atkW && attacks.length > 0) {
    pick = randPick(attacks); memory.consecutiveDefenses = 0;
  } else if (roll < atkW + defW && defenses.length > 0 && !forceNoDef) {
    pick = randPick(defenses); memory.consecutiveDefenses++;
  } else if (roll < atkW + defW + spW && specials.length > 0) {
    pick = randPick(specials); memory.consecutiveDefenses = 0;
  } else {
    const fallback = charges.length > 0 ? charges : affordable;
    pick = randPick(fallback); memory.consecutiveDefenses = 0;
  }

  if (!pick) pick = randPick(affordable);
  return makeTargets(pick, bot, others);
}

// ================================================================
// NORMAL — opponent modeling + prediction + counter-play
// ================================================================
function normalBot(
  bot: PlayerState, available: MoveDef[], others: PlayerState[],
  round: number, memory: BotMemory
): { moveId: string; targets: string[] } {
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) return { moveId: 'yun', targets: [] };

  // Round 1 — probe: only 运/欧/跺
  if (round === 1) {
    const r1 = affordable.filter(m => ['yun', 'ou', 'duo'].includes(m.id));
    return makeTargets(r1.length > 0 ? randPick(r1) : getMoveById('yun')!, bot, others);
  }

  // ---- Opponent modeling ----
  const primaryOpp = pickPrimaryTarget(bot, others, memory);
  const predictions = predictOpponentMoves(primaryOpp, memory);

  // ---- Score all my options against predictions ----
  const scored: ScoredMove[] = affordable.map(m => {
    let score = 0;
    for (const pred of predictions) {
      const outcome = evalOutcome(m, pred.move, bot, primaryOpp);
      score += pred.prob * outcome;
    }
    // Add noise: 15% randomness
    score += noise(score * 0.15);
    // Personality bias
    if (memory.personality === 'aggressive' && m.atk > 0) score += 8;
    if (memory.personality === 'conservative' && m.def > 0) score += 8;
    return { move: m, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // 5% "mistake" — pick a random move for unpredictability
  if (Math.random() < 0.05) {
    return makeTargets(randPick(affordable), bot, others);
  }

  return makeTargets(scored[0].move, bot, others);
}

// ================================================================
// Opponent modeling
// ================================================================

interface Tendencies { attack: number; defense: number; charge: number; special: number; }

function getOpponentTendencies(memory: BotMemory, others: PlayerState[]): Tendencies {
  let atk = 0, def = 0, ch = 0, sp = 0, total = 0;
  for (const opp of others) {
    const hist = memory.opponentHistory.get(opp.id) || [];
    for (const mid of hist) {
      const m = getMoveById(mid);
      if (!m) continue;
      if (m.atk > 0) atk++;
      else if (m.def > 0 || m.type === 'special_defense') def++;
      else if (m.type === 'charge') ch++;
      else sp++;
      total++;
    }
  }
  if (total === 0) return { attack: 0.4, defense: 0.2, charge: 0.3, special: 0.1 };
  return { attack: atk / total, defense: def / total, charge: ch / total, special: sp / total };
}

/** Pick the most threatening or familiar opponent */
function pickPrimaryTarget(bot: PlayerState, others: PlayerState[], memory: BotMemory): PlayerState {
  // Prefer opponent with most history (most familiar)
  let best = others[0];
  let bestHist = 0;
  for (const o of others) {
    const h = (memory.opponentHistory.get(o.id) || []).length;
    if (h > bestHist) { bestHist = h; best = o; }
  }
  return best;
}

interface Prediction { move: MoveDef; prob: number; }

/** Predict what an opponent is likely to do this round */
function predictOpponentMoves(opp: PlayerState, memory: BotMemory): Prediction[] {
  const hist = memory.opponentHistory.get(opp.id) || [];
  const oppAvailable = getMovesByLevel(opp.level).filter(m => opp.energy >= m.cost);
  if (oppAvailable.length === 0) return [{ move: getMoveById('yun')!, prob: 1 }];

  // 1. Count frequency of each move type in history
  const freq: Record<string, number> = {};
  for (const mid of hist) { freq[mid] = (freq[mid] || 0) + 1; }

  // 2. Detect 2-step patterns: if hist ends with [A, B], look for what followed A→B before
  let patternPrediction: string | null = null;
  if (hist.length >= 2) {
    const last2 = hist.slice(-2).join(',');
    for (let i = 0; i < hist.length - 2; i++) {
      if (hist[i] + ',' + hist[i + 1] === last2 && i + 2 < hist.length) {
        patternPrediction = hist[i + 2];
        break;
      }
    }
  }

  // 3. Energy-based heuristics
  const lowEnergy = opp.energy < 1.5;
  const highEnergy = opp.energy >= 4;

  // 4. Build prediction list
  const predictions: Prediction[] = [];

  for (const m of oppAvailable) {
    let prob = 0.1; // base

    // Frequency bonus
    prob += (freq[m.id] || 0) / Math.max(hist.length, 1) * 0.3;

    // Pattern bonus
    if (m.id === patternPrediction) prob += 0.25;

    // Energy heuristics
    if (lowEnergy && m.type === 'charge') prob += 0.2;
    if (lowEnergy && m.atk > 0 && m.cost > opp.energy) prob -= 0.5; // can't afford
    if (highEnergy && m.atk >= 50) prob += 0.15;
    if (m.type === 'defense' || m.type === 'special_defense') {
      // More likely to defend if low HP (1 HP game, always low HP)
      prob += 0.05;
    }

    // If opponent has 欧, some chance they use it
    if (m.id === 'ou' && opp.energy >= 0) prob += 0.1;
    if (m.id === 'duo') prob += 0.05;

    predictions.push({ move: m, prob: Math.max(0, prob) });
  }

  // Normalize to sum = 1 and take top 5
  const total = predictions.reduce((s, p) => s + p.prob, 0) || 1;
  predictions.forEach(p => p.prob /= total);
  predictions.sort((a, b) => b.prob - a.prob);
  return predictions.slice(0, 5);
}

// ================================================================
// Outcome evaluation
// ================================================================

/** Evaluate how good it is for bot to play `myMove` when opponent plays `oppMove`.
 *  Returns -100 (bot dies) to +100 (opponent dies). */
function evalOutcome(myMove: MoveDef, oppMove: MoveDef, bot: PlayerState, opp: PlayerState): number {
  // Opponent is attacking me
  if (oppMove.atk > 0 && oppMove.targetType !== 'none') {
    // I'm also attacking → mutual combat
    if (myMove.atk > 0) {
      const diff = Math.abs(myMove.atk - oppMove.atk);
      if (diff < 9) return 5;   // draw, safe
      if (myMove.atk > oppMove.atk) return 100;  // I win
      return -100;  // I die
    }
    // I'm defending
    if (myMove.def > 0 || myMove.type === 'special_defense') {
      // Check rule blocks
      if (myMove.specialEffect === 'longdun_block' && ['longzhua', 'xianglong'].includes(oppMove.id)) return 30;
      if (myMove.specialEffect === 'dudun_block' && oppMove.id === 'du') return 30;
      if (myMove.specialEffect === 'duo_counter' && oppMove.id === 'ou') return 200;
      if (myMove.def >= oppMove.atk) return 20;  // blocked
      return -100;  // defense broken, I die
    }
    // I'm doing something else (charge, special) → I die
    if (myMove.id === 'ou' && oppMove.atk > 0) return -100;
    return -100;
  }

  // Opponent is defending
  if (oppMove.def > 0 || oppMove.type === 'special_defense') {
    if (myMove.atk > 0) {
      if (oppMove.specialEffect === 'longdun_block' && ['longzhua', 'xianglong'].includes(myMove.id)) return -10;
      if (oppMove.specialEffect === 'dudun_block' && myMove.id === 'du') return -10;
      if (myMove.atk > oppMove.def) return 100;  // break through
      return -15;  // blocked, wasted energy
    }
    if (myMove.type === 'charge') return 15;  // free charge vs defense
    return 5;  // both do nothing
  }

  // Opponent is charging (运)
  if (oppMove.type === 'charge') {
    if (myMove.atk > 0) return 100;    // free hit
    if (myMove.id === 'ou') return 80; // steal their gain
    if (myMove.type === 'charge') return 5;  // both charge
    return 5;
  }

  // Opponent is using 欧
  if (oppMove.specialEffect === 'ou_steal') {
    if (myMove.id === 'duo') return 200;   // counter-kill
    if (myMove.type === 'charge') return -80;  // I get stolen
    if (myMove.atk > 0) return 100;   // I attack, they have no defense
    return -20;
  }

  // Opponent is using 跺
  if (oppMove.specialEffect === 'duo_counter') {
    if (myMove.id === 'ou') return -200;  // I get countered
    if (myMove.atk > 0) return 100;  // 跺 has 0 def, free kill
    return 5;
  }

  // Opponent using 观音坐莲 (invincible)
  if (oppMove.specialEffect === 'guanyin_buff') {
    if (myMove.atk > 0) return -15;  // wasted attack on invincible
    if (myMove.type === 'charge') return 10;
    return 5;
  }

  return 10; // fallback
}

// ================================================================
// Record + targets
// ================================================================

/** Record a player's move in opponent history (called externally after reveal) */
export function recordOpponentMove(memory: BotMemory, opponentId: string, moveId: string): void {
  if (!memory.opponentHistory.has(opponentId)) {
    memory.opponentHistory.set(opponentId, []);
  }
  const hist = memory.opponentHistory.get(opponentId)!;
  hist.push(moveId);
  if (hist.length > 5) hist.shift();  // keep last 5
}

function makeTargets(
  move: MoveDef, bot: PlayerState, others: PlayerState[]
): { moveId: string; targets: string[] } {
  if (move.targetType === 'none' || move.targetType === 'all') {
    return { moveId: move.id, targets: [] };
  }
  if (move.targetType === 'single') {
    // Prefer opponent with no defense in history (easier target)
    return { moveId: move.id, targets: [randPick(others).id] };
  }
  const shuffled = [...others].sort(() => Math.random() - 0.5);
  const count = others.length >= 2 ? (Math.random() < 0.5 ? 1 : 2) : 1;
  return { moveId: move.id, targets: shuffled.slice(0, count).map(p => p.id) };
}
