import { PlayerState, BotLevel, MoveDef } from '../../shared/types';
import { getMovesByLevel, getMoveById } from '../data/moves';

// ---- Types ----
export interface BotMemory {
  consecutiveDefenses: number;
  opponentHistory: Map<string, string[]>;
  strategy: StrategyProfile;
}

// ---- Utils ----
function randInt(max: number): number { return Math.floor(Math.random() * max); }
function randPick<T>(arr: T[]): T { return arr[randInt(arr.length)]; }
function noise(scale: number) { return (Math.random() - 0.5) * 2 * scale; }
function sum(arr: number[]) { return arr.reduce((a, b) => a + b, 0); }

export function createBotMemory(): BotMemory {
  return {
    consecutiveDefenses: 0,
    opponentHistory: new Map(),
    strategy: randPick(STRATEGIES),
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
  atkW = Math.round(atkW * memory.strategy.attackBias);
  defW = Math.round(defW * memory.strategy.defenseBias);
  chW = Math.round(chW * memory.strategy.chargeBias);
  spW = Math.round(spW * memory.strategy.specialBias);
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

const RECURSE_DEPTH = 5;
const CANDIDATE_COUNT = 6;

// ================================================================
// Strategy profiles — each bot randomly picks one at creation
// ================================================================
interface StrategyProfile {
  name: string;
  attackBias: number;      // multiplier on ATK scores (1.0 = neutral)
  defenseBias: number;     // multiplier on DEF scores
  chargeBias: number;      // multiplier on 运 scores
  specialBias: number;     // multiplier on 欧/跺 scores
  riskTolerance: number;   // 0–1: when behind, how much to gamble vs play safe
  energyThreshold: number; // min energy before unleashing heavy attacks
  aggressionOnLead: number;// when ahead in energy, how hard to press (0–2)
}

const STRATEGIES: StrategyProfile[] = [
  {
    name: '猛攻型',
    attackBias: 1.5, defenseBias: 0.5, chargeBias: 0.8, specialBias: 0.7,
    riskTolerance: 0.8, energyThreshold: 2, aggressionOnLead: 1.8,
  },
  {
    name: '稳健型',
    attackBias: 0.7, defenseBias: 1.8, chargeBias: 1.5, specialBias: 0.9,
    riskTolerance: 0.2, energyThreshold: 5, aggressionOnLead: 0.5,
  },
  {
    name: '诡诈型',
    attackBias: 0.8, defenseBias: 0.6, chargeBias: 0.7, specialBias: 2.2,
    riskTolerance: 0.6, energyThreshold: 3, aggressionOnLead: 0.8,
  },
  {
    name: '均衡型',
    attackBias: 1.0, defenseBias: 1.0, chargeBias: 1.0, specialBias: 1.0,
    riskTolerance: 0.5, energyThreshold: 3, aggressionOnLead: 1.0,
  },
  {
    name: '赌徒型',
    attackBias: 1.3, defenseBias: 0.2, chargeBias: 1.2, specialBias: 0.5,
    riskTolerance: 0.95, energyThreshold: 1, aggressionOnLead: 2.0,
  },
];

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
  _myFullOptions: MoveDef[],
  depth: number,
  memory: BotMemory
): number {
  // Opponent picks their best response to myMove
  const oppScores = oppCandidates.map(oppMove => {
    const outcome = evalExchange(myMove, oppMove, me, opp);

    // Terminal: someone died
    if (outcome.myDeath) return -2000;
    if (outcome.oppDeath) return 2000;

    const newMeEnergy = me.energy - myMove.cost + outcome.myEnergyDelta;
    const newOppEnergy = opp.energy - oppMove.cost + outcome.oppEnergyDelta;

    // Leaf: use strategic position evaluation
    if (depth <= 0) {
      return leafEval(newMeEnergy, newOppEnergy, me.level, opp.level, memory.strategy);
    }

    // Recursive: from this new state, what's the best I can do next round?
    const myNewOptions = getMovesByLevel(me.level).filter(m => newMeEnergy >= m.cost);
    const oppNewOptions = getMovesByLevel(opp.level).filter(m => newOppEnergy >= m.cost);

    let futureScore = 0;
    if (myNewOptions.length > 0 && oppNewOptions.length > 0) {
      const topMyNext = rankCandidates(myNewOptions,
        { ...me, energy: newMeEnergy },
        { ...opp, energy: newOppEnergy },
        memory
      ).slice(0, 3);

      // My best outcome from the resulting position
      futureScore = Math.max(...topMyNext.map(m =>
        minimaxEval(m, oppNewOptions.slice(0, CANDIDATE_COUNT),
          { ...me, energy: newMeEnergy },
          { ...opp, energy: newOppEnergy },
          myNewOptions, depth - 1, memory)
      ));
    }

    return futureScore;
  });

  // Opponent picks the move WORST for me (zero-sum)
  oppScores.sort((a, b) => a - b);
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

/**
 * Strategic position evaluation (leaf nodes).
 * "谁在这个能量局面下更可能最终获胜？"
 * 不只看单回合死不死，而是评估长期博弈位置。
 */
function leafEval(myEnergy: number, oppEnergy: number, myLevel: number, oppLevel: number, strategy: StrategyProfile): number {
  let score = 0;

  // === Energy differential (base) ===
  score += (myEnergy - oppEnergy) * 10;

  // === Kill threat: can either side threaten a kill? ===
  const myMoves = getMovesByLevel(myLevel);
  const oppMoves = getMovesByLevel(oppLevel);

  const myMaxATK = Math.max(...myMoves.filter(m => myEnergy >= m.cost && m.atk > 0).map(m => m.atk), 0);
  const oppMaxATK = Math.max(...oppMoves.filter(m => oppEnergy >= m.cost && m.atk > 0).map(m => m.atk), 0);
  const myMaxDEF = Math.max(...myMoves.filter(m => myEnergy >= m.cost && m.def > 0).map(m => m.def), 0);
  const oppMaxDEF = Math.max(...oppMoves.filter(m => oppEnergy >= m.cost && m.def > 0).map(m => m.def), 0);

  // I can OHKO and opponent can't block → massive advantage
  if (myMaxATK > oppMaxDEF && myMaxATK >= 30) score += 60;
  if (oppMaxATK > myMaxDEF && oppMaxATK >= 30) score -= 60;

  // I can挂机(50ATK) and opponent can't超防 → winning position
  if (myMaxATK >= 50 && oppMaxDEF < 50) score += 40;
  if (oppMaxATK >= 50 && myMaxDEF < 50) score -= 40;

  // === Initiative: who controls the tempo ===
  // Being able to attack while opponent can't afford anything is huge
  const iCanAttack = myMaxATK > 0;
  const oppCanAttack = oppMaxATK > 0;
  const iCanCharge = myEnergy < 8;  // always true in practice
  const oppCanCharge = oppEnergy < 8;

  if (iCanAttack && !oppCanAttack && oppEnergy < 0.5) score += 35;  // I have weapon, opponent broke
  if (oppCanAttack && !iCanAttack && myEnergy < 0.5) score -= 35;

  // === Energy snowball: gap compounds ===
  // Being up 2+ energy means opponent is in danger zone
  const gap = myEnergy - oppEnergy;
  if (gap >= 3) score += 50;   // dominant — can挂机 while opponent scrambles
  if (gap >= 2) score += 25;   // strong lead
  if (gap <= -3) score -= 50;  // desperate — must take risks
  if (gap <= -2) score -= 25;

  // === Desperation: when badly behind, risky plays are better ===
  if (oppMaxATK >= 50 && myMaxDEF < 50 && gap < 0) {
    score -= 30;
  }

  // === Risk tolerance: how much does being behind actually hurt? ===
  // Low tolerance → being behind feels terrible → play safe, defend
  // High tolerance → being behind is just a temporary setback → gamble
  if (gap < 0) {
    score = score * (1 - strategy.riskTolerance * 0.6);
  }

  return score;
}

/** Base heuristic score for a move (used for candidate ranking only, not leaf eval) */
function baseScore(move: MoveDef, _me: PlayerState, _opp: PlayerState): number {
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
    // Apply strategy profile
    if (m.atk > 0) s *= memory.strategy.attackBias;
    if (m.def > 0 || m.type === 'special_defense') s *= memory.strategy.defenseBias;
    if (m.type === 'charge') s *= memory.strategy.chargeBias;
    if (m.type === 'special') s *= memory.strategy.specialBias;
    // Context: favor defense if opponent attacks often
    if (m.def > 0 && oppAtkFreq > 0.4) s += m.def * 0.5;
    // Energy management: don't rush big attacks below threshold
    if (m.atk >= 50 && player.energy < memory.strategy.energyThreshold) s -= 25;
    // Press harder when ahead
    if (m.atk > 0 && player.energy > opponent.energy) s *= memory.strategy.aggressionOnLead;
    s += noise(8);
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
