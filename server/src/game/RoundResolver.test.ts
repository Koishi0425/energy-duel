import { describe, expect, it } from 'vitest';
import { resolveRound, validateAction, type CombatPlayer, type SubmittedAction } from './RoundResolver.js';

function roster(...players: Array<[string, number]>): Map<string, CombatPlayer> {
  return new Map(players.map(([id, energy]) => [id, {
    id, nickname: id.toUpperCase(), resources: { energy }, currentHp: 1, maxHp: 1, alive: true,
  }]));
}

function actions(...items: Array<[string, SubmittedAction]>): Map<string, SubmittedAction> {
  return new Map(items);
}

describe('RoundResolver JSON-driven actions', () => {
  it('charges one energy', () => {
    const players = roster(['a', 0], ['b', 0]);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')?.resources.energy).toBe(1);
  });

  it('steals the generated energy from a charging target', () => {
    const players = roster(['a', 0], ['b', 0]);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'steal', targetId: 'a' }]));
    expect(players.get('a')?.resources.energy).toBe(0);
    expect(players.get('b')?.resources.energy).toBe(1);
  });

  it('chop cancels every steal and eliminates the stealers', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    resolveRound(players, actions(
      ['a', { actionId: 'charge' }], ['b', { actionId: 'steal', targetId: 'a' }], ['c', { actionId: 'chop' }],
    ));
    expect(players.get('a')?.resources.energy).toBe(1);
    expect(players.get('b')?.alive).toBe(false);
    expect(players.get('b')?.currentHp).toBe(0);
  });

  it('defense blocks wave and super defense blocks all attacks', () => {
    const players = roster(['a', 2], ['b', 0], ['c', 1], ['d', 3]);
    resolveRound(players, actions(
      ['a', { actionId: 'wave', targetId: 'b' }], ['b', { actionId: 'defend' }],
      ['c', { actionId: 'super_defend' }], ['d', { actionId: 'hangup' }],
    ));
    expect(players.get('b')?.alive).toBe(false);
    expect(players.get('c')?.alive).toBe(true);
    expect(players.get('a')?.alive).toBe(false);
  });

  it('hangup costs three and ignores normal defense', () => {
    const players = roster(['a', 3], ['b', 0]);
    resolveRound(players, actions(['a', { actionId: 'hangup' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')?.resources.energy).toBe(0);
    expect(players.get('b')?.alive).toBe(false);
  });

  it('validates configuration costs and target modes', () => {
    const players = roster(['a', 0], ['b', 0]);
    expect(() => validateAction(players.get('a')!, { actionId: 'wave', targetId: 'b' }, players)).toThrow(/资源不足/);
    expect(() => validateAction(players.get('a')!, { actionId: 'steal' }, players)).toThrow(/请选择/);
    expect(() => validateAction(players.get('a')!, { actionId: 'defend', targetId: 'b' }, players)).toThrow(/不接受/);
  });
});
