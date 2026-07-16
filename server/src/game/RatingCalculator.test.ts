import { describe, expect, it } from 'vitest';
import { calculateGameScore, calculateRating, retainRatingScores, type StoredRatingScore } from './RatingCalculator.js';

describe('rating calculator', () => {
  it('caps a perfect winning performance at 330', () => {
    expect(calculateGameScore({ outcome: 'win', roundsParticipated: 20, totalRounds: 20, actionsCompleted: 20, damageStatesDealt: 8, eliminations: 4, successfulDefenses: 5, recoveryStates: 3 }).totalScore).toBe(330);
  });

  it('produces an explainable partial score', () => {
    expect(calculateGameScore({ outcome: 'loss', roundsParticipated: 3, totalRounds: 6, actionsCompleted: 3, damageStatesDealt: 1, eliminations: 0, successfulDefenses: 1, recoveryStates: 1 })).toEqual({ formulaVersion: 1, resultScore: 60, survivalScore: 20, offenseScore: 12, defenseScore: 14, participationScore: 6, totalScore: 112 });
  });

  it('adds best 35 and recent 15, allowing overlap', () => {
    const scores = Array.from({ length: 40 }, (_, index): StoredRatingScore => ({ gameId: String(index), score: index + 1, formulaVersion: 1, playedAt: new Date(index * 1000).toISOString() }));
    const summary = calculateRating(scores);
    expect(summary.best35Contribution).toBe(Array.from({ length: 35 }, (_, index) => index + 6).reduce((a, b) => a + b, 0));
    expect(summary.recent15Contribution).toBe(Array.from({ length: 15 }, (_, index) => index + 26).reduce((a, b) => a + b, 0));
  });

  it('retains the union of top 35 and latest 15', () => {
    const scores = Array.from({ length: 80 }, (_, index): StoredRatingScore => ({ gameId: String(index), score: index < 35 ? 330 : 1, formulaVersion: 1, playedAt: new Date(index * 1000).toISOString() }));
    const retained = retainRatingScores(scores);
    expect(retained).toHaveLength(50); expect(retained.slice(0, 35).every((item) => item.score === 330)).toBe(true); expect(retained.at(-1)?.gameId).toBe('79');
  });
});
