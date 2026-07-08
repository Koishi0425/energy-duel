import { PlayerState, BotLevel, MoveDef } from '../../shared/types';
import { getMovesByLevel, getMoveById } from '../data/moves';

// ---- Types ----
export interface BotMemory {
  consecutiveDefenses: number;
  opponentHistory: Map<string, string[]>;
  personality: 'aggressive' | 'balanced' | 'conservative';
}

// ---- Utils ----
function randInt(max: number): number { return Math.floor(Math.random() * max); }
function randPick<T>(arr: T[]): T { return arr[randInt(arr.length)]; }
function noise(scale: number) { return (Math.random() - 0.5) * 2 * scale; }
function sum(arr: number[]) { return arr.reduce((a, b) => a + b, 0); }

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
  level: BotLevel, bot: PlayerState, allPlayers: PlayerState[],
  round: number, memory: BotMemory
): { moveId: string; targets: string[] } {
  const available = getMovesByLevel(bot.level);
  const others = allPlayers.filter(p => p.alive && p.id !== bot.id);
  if (others.length === 0) return { moveId: 'yun', targets: [] };

  if (level === 'easy') return easyBot(bot, available, others, round, memory);
  return normalBot(bot, available, others, round, memory);
}

// ================================================================
// EASY — tendency stats + weighted random (unchanged core)
// ================================================================
function easyBot(
  bot: PlayerState, available: MoveDef[], others: PlayerState[],
  _round: number, memory: BotMemory
): { moveId: string; targets: string[] } {
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) { memory.consecutiveDefenses = 0; return { moveId: 'yun', targets: [] }; }

  const tendencies = getOpponentTendencies(memory, others);
  const oppAtkRate = tendencies.attack;
  const forceNoDef = memory.consecutiveDefenses >= 2;

  const attacks = affordable.filter(m => m.atk > 0);
  const defenses = affordable.filter(m => m.def > 0 || m.type === 'special_defense');
  const specials = affordable.filter(m => m.type === 'special');
  const charges = affordable.filter(m => m.type === 'charge');

  let atkW = 50, defW = 25, spW = 15, chW = 10;
  if (oppAtkRate > 0.5) { defW += 20; atkW -= 15; }
  if (tendencies.defense > 0.4) { chW += 15; atkW -= 10; }
  if (memory.personality === 'aggressive') { atkW += 15; defW -= 10; }
  if (memory.personality === 'conservative') { defW += 15; atkW -= 10; }
  if (forceNoDef) { defW = 0; atkW += 20; }

  const totalW = atkW + defW + spW + chW;
  const roll = Math.random() * totalW;
  let pick: MoveDef | undefined;

  if (roll < atkW && attacks.length > 0) {
    pick = randPick(attacks); memory.consecutiveDefenses = 0;
  } else if (roll < atkW + defW && defenses.length > 0 && !forceNoDef) {
    pick = randPick(defenses); memory.consecutiveDefenses++;
  } else if (roll < atkW + defW + spW && specials.length > 0) {
    pick = randPick(specials); memory.consecutiveDefenses = 0;
  } else {
    pick = randPick(charges.length > 0 ? charges : affordable);
    memory.consecutiveDefenses = 0;
  }
  if (!pick) pick = randPick(affordable);
  return makeTargets(pick, bot, others);
}

// ================================================================
// NORMAL — recursive counter-prediction (game theory)
// ================================================================

const RECURSE_DEPTH = 3;     // how many layers of "I think that you think that I think..."
const CANDIDATE_COUNT = 6;   // top N moves to consider at each layer

function normalBot(
  bot: PlayerState, available: MoveDef[], others: PlayerState[],
  round: number, memory: BotMemory
): { moveId: string; targets: string[] } {
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) return { moveId: 'yun', targets: [] };

  // Round 1 — probe
  if (round === 1) {
    const r1 = affordable.filter(m => ['yun', 'ou', 'duo'].includes(m.id));
    return makeTargets(r1.length > 0 ? randPick(r1) : getMoveById('yun')!, bot, others);
  }

  const opp = pickPrimaryTarget(bot, others, memory);
  const oppAvailable = getMovesByLevel(opp.level).filter(m => opp.energy >= m.cost);
  if (oppAvailable.length === 0) {
    // Opponent can't do anything → attack if possible
    const atks = affordable.filter(m => m.atk > 0);
    if (atks.length > 0) return makeTargets(randPick(atks), bot, others);
    return makeTargets(getMoveById('yun')!, bot, others);
  }

  // ---- Rank my candidate moves ----
  const myCandidates = rankCandidates(affordable, bot, opp, memory);
  const oppCandidates = rankCandidates(oppAvailable, opp, bot, memory);

  // ---- Recursive evaluation ----
  const scored = myCandidates.map(m => ({
    move: m,
    score: minimaxEval(
      m, oppCandidates, bot, opp, myCandidates,
      RECURSE_DEPTH, memory
    ),
  }));

  scored.sort((a, b) => b.score - a.score);

  // 5% "mistake"
  if (Math.random() < 0.05) {
    return makeTargets(randPick(affordable), bot, others);
  }

  return makeTargets(scored[0].move, bot, others);
}

// ================================================================
// Recursive minimax: "I think that you think that I think..."
// ================================================================

/**
 * Evaluate myMove against opponent's possible responses.
 * Positive score = good for me. Negative = good for opponent.
 */
function minimaxEval(
  myMove: MoveDef,
  oppCandidates: MoveDef[],
  me: PlayerState,
  opp: PlayerState,
  myFullOptions: MoveDef[],
  depth: number,
  memory: BotMemory
): number {
  if (depth <= 0) return baseScore(myMove, me, opp);

  // Opponent picks their best move assuming I played myMove
  // For each opponent move, evaluate the resulting state
  const oppScores = oppCandidates.map(oppMove => {
    const outcome = evalExchange(myMove, oppMove, me, opp);

    // Build resulting state after exchange
    const newMeEnergy = me.energy - myMove.cost + outcome.myEnergyDelta;
    const newOppEnergy = opp.energy - oppMove.cost + outcome.oppEnergyDelta;

    // Recursive: what would *I* play from this new state?
    // My best response from the new state (limited depth)
    const myNewOptions = getMovesByLevel(me.level).filter(m => newMeEnergy >= m.cost);
    const oppNewOptions = getMovesByLevel(opp.level).filter(m => newOppEnergy >= m.cost);

    let futureScore = 0;
    if (depth > 1 && myNewOptions.length > 0 && oppNewOptions.length > 0) {
      const topMyNext = rankCandidates(myNewOptions,
        { ...me, energy: newMeEnergy },
        { ...opp, energy: newOppEnergy },
        memory
      ).slice(0, 3);

      // Opponent evaluates from their perspective (negated)
      const bestForOpp = Math.max(...topMyNext.map(m =>
        minimaxEval(m, oppNewOptions.slice(0, CANDIDATE_COUNT),
          { ...me, energy: newMeEnergy },
          { ...opp, energy: newOppEnergy },
          myNewOptions, depth - 1, memory)
      ));
      futureScore = bestForOpp;
    }

    // If I die → very bad. If opponent dies → very good.
    if (outcome.myDeath) return -1000;
    if (outcome.oppDeath) return 1000;

    return futureScore + (newMeEnergy - newOppEnergy) * 15;
  });

  // Opponent will pick the move that's WORST for me (best for them)
 // Sort: lowest first (worst for me)
  oppScores.sort((a, b) => a - b);

  // Weighted average of opponent's likely responses (assume they pick near-optimal)
  const topK = oppScores.slice(0, 3);
  return sum(topK) / topK.length;
}

/** Outcome of one exchange */
interface ExchangeOutcome {
  myDeath: boolean;
  oppDeath: boolean;
  myEnergyDelta: number;
  oppEnergyDelta: number;
}

function evalExchange(
  myMove: MoveDef, oppMove: MoveDef, me: PlayerState, opp: PlayerState
): ExchangeOutcome {
  let myDeath = false, oppDeath = false;
  let myEnergyDelta = 0, oppEnergyDelta = 0;

  // Energy gains
  if (myMove.id === 'yun') myEnergyDelta += 1;
  if (oppMove.id === 'yun') oppEnergyDelta += 1;

  // 欧 steal
  if (myMove.specialEffect === 'ou_steal') {
    if (oppMove.id === 'yun') { myEnergyDelta += 2; oppEnergyDelta -= 1; }
    if (oppMove.specialEffect === 'ou_steal') { /* chain handled externally */ }
  }
  if (oppMove.specialEffect === 'ou_steal') {
    if (myMove.id === 'yun') { oppEnergyDelta += 2; myEnergyDelta -= 1; }
  }

  // 跺 counter
  if (myMove.specialEffect === 'duo_counter' && oppMove.specialEffect === 'ou_steal') {
    oppDeath = true;
  }
  if (oppMove.specialEffect === 'duo_counter' && myMove.specialEffect === 'ou_steal') {
    myDeath = true;
  }

  // Attack resolution (if no one died from 跺 yet)
  if (!myDeath && !oppDeath) {
    const iAttack = myMove.atk > 0;
    const oppAttack = oppMove.atk > 0;

    if (iAttack && oppAttack) {
      // Mutual attack
      const diff = Math.abs(myMove.atk - oppMove.atk);
      if (diff >= 9) {
        if (myMove.atk < oppMove.atk) myDeath = true;
        else oppDeath = true;
      }
    } else if (iAttack && (oppMove.def > 0 || oppMove.type === 'special_defense')) {
      // I attack, opponent defends
      if (oppMove.specialEffect === 'longdun_block' && ['longzhua', 'xianglong'].includes(myMove.id)) { /* blocked */ }
      else if (oppMove.specialEffect === 'dudun_block' && myMove.id === 'du') { /* blocked */ }
      else if (myMove.atk > oppMove.def) oppDeath = true;
    } else if (iAttack && !oppAttack) {
      // I attack, opponent not defending → kill
      oppDeath = true;
    } else if (oppAttack && (myMove.def > 0 || myMove.type === 'special_defense')) {
      // Opponent attacks, I defend
      if (myMove.specialEffect === 'longdun_block' && ['longzhua', 'xianglong'].includes(oppMove.id)) { /* blocked */ }
      else if (myMove.specialEffect === 'dudun_block' && oppMove.id === 'du') { /* blocked */ }
      else if (oppMove.atk > myMove.def) myDeath = true;
    } else if (oppAttack && !iAttack) {
      // Opponent attacks, I not defending → I die
      myDeath = true;
    }
  }

  return { myDeath, oppDeath, myEnergyDelta, oppEnergyDelta };
}

/** Base heuristic score for a move */
function baseScore(move: MoveDef, me: PlayerState, _opp: PlayerState): number {
  let s = 0;
  if (move.atk > 0) s += move.atk * 1.5;
  if (move.def > 0) s += move.def * 0.8;
  if (move.type === 'charge') s += 12;
  s -= move.cost * 4;
  if (move.atk >= 50) s += 18;
  if (move.specialEffect === 'ou_steal') s += 15;
  if (move.specialEffect === 'duo_counter') s += 5;
  if (move.specialEffect === 'guanyin_buff') s += 30;
  return s;
}

// ================================================================
// Candidate ranking (heuristic pre-filter)
// ================================================================

function rankCandidates(
  moves: MoveDef[], player: PlayerState, opponent: PlayerState,
  memory: BotMemory
): MoveDef[] {
  const hist = memory.opponentHistory.get(opponent.id) || [];
  const oppAtkFreq = hist.filter(mid => {
    const m = getMoveById(mid); return m && m.atk > 0;
  }).length / Math.max(hist.length, 1);

  const scored = moves.map(m => {
    let s = baseScore(m, player, opponent);
    // Favor defense if opponent attacks often
    if (m.def > 0 && oppAtkFreq > 0.4) s += m.def * 0.5;
    // Personality
    if (memory.personality === 'aggressive' && m.atk > 0) s += 10;
    if (memory.personality === 'conservative' && m.def > 0) s += 10;
    s += noise(8); // small randomness so tied scores vary
    return { move: m, score: s };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, CANDIDATE_COUNT).map(s => s.move);
}

// ================================================================
// Tendencies + target selection
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

function pickPrimaryTarget(bot: PlayerState, others: PlayerState[], memory: BotMemory): PlayerState {
  let best = others[0], bestHist = 0;
  for (const o of others) {
    const h = (memory.opponentHistory.get(o.id) || []).length;
    if (h > bestHist) { bestHist = h; best = o; }
  }
  return best;
}

// ================================================================
// Opponent history recording
// ================================================================

export function recordOpponentMove(memory: BotMemory, opponentId: string, moveId: string): void {
  if (!memory.opponentHistory.has(opponentId)) {
    memory.opponentHistory.set(opponentId, []);
  }
  const hist = memory.opponentHistory.get(opponentId)!;
  hist.push(moveId);
  if (hist.length > 5) hist.shift();
}

// ================================================================
// Target selection
// ================================================================

function makeTargets(
  move: MoveDef, bot: PlayerState, others: PlayerState[]
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
