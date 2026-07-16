export const RATING_FORMULA_VERSION = 1;
export const MAX_GAME_SCORE = 330;

export interface GamePerformanceInput {
  outcome: 'win' | 'loss' | 'draw';
  roundsParticipated: number;
  totalRounds: number;
  actionsCompleted: number;
  damageStatesDealt: number;
  eliminations: number;
  successfulDefenses: number;
  recoveryStates: number;
}

export interface GameScoreBreakdown {
  formulaVersion: number;
  resultScore: number;
  survivalScore: number;
  offenseScore: number;
  defenseScore: number;
  participationScore: number;
  totalScore: number;
}

export interface StoredRatingScore {
  gameId: string;
  score: number;
  formulaVersion: number;
  playedAt: string;
}

export interface RatingSummary {
  rating: number;
  best35Contribution: number;
  recent15Contribution: number;
}

export function calculateGameScore(input: GamePerformanceInput): GameScoreBreakdown {
  const resultScore = input.outcome === 'win' ? 180 : input.outcome === 'draw' ? 120 : 60;
  const survivalScore = Math.round(40 * clamp(input.roundsParticipated / Math.max(1, input.totalRounds), 0, 1));
  const offenseScore = Math.min(60, Math.round(Math.max(0, input.damageStatesDealt) * 12 + Math.max(0, input.eliminations) * 18));
  const defenseScore = Math.min(30, Math.round(Math.max(0, input.successfulDefenses) * 6 + Math.max(0, input.recoveryStates) * 8));
  const participationScore = Math.min(20, Math.max(0, Math.floor(input.actionsCompleted)) * 2);
  const totalScore = Math.min(MAX_GAME_SCORE, resultScore + survivalScore + offenseScore + defenseScore + participationScore);
  return { formulaVersion: RATING_FORMULA_VERSION, resultScore, survivalScore, offenseScore, defenseScore, participationScore, totalScore };
}

export function calculateRating(scores: readonly StoredRatingScore[]): RatingSummary {
  const recent15 = scores.slice(-15);
  const best35 = [...scores].sort((left, right) => right.score - left.score || right.playedAt.localeCompare(left.playedAt)).slice(0, 35);
  const best35Contribution = best35.reduce((sum, item) => sum + clampScore(item.score), 0);
  const recent15Contribution = recent15.reduce((sum, item) => sum + clampScore(item.score), 0);
  return { rating: Math.min(16_500, best35Contribution + recent15Contribution), best35Contribution, recent15Contribution };
}

export function retainRatingScores(scores: readonly StoredRatingScore[]): StoredRatingScore[] {
  const recent = scores.slice(-15); const best = [...scores].sort((left, right) => right.score - left.score || right.playedAt.localeCompare(left.playedAt)).slice(0, 35);
  const retainedIds = new Set([...recent, ...best].map((item) => item.gameId));
  return scores.filter((item) => retainedIds.has(item.gameId));
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum)); }
function clampScore(value: number): number { return Math.round(clamp(value, 0, MAX_GAME_SCORE)); }
