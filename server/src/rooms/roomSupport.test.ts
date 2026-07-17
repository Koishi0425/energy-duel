import { describe, expect, it } from 'vitest';
import { assertAccountAvailable, assignGridIndices, claimRoomCode, colorForAccount, isActionUnlocked, normalizeRoomCode, releaseRoomCode, tickScopedBuffs } from './roomSupport.js';

describe('room support', () => {
  it('assigns unique even indices after joins and leaves', () => {
    const players = [
      { accountId: 'a', gridIndex: -1 },
      { accountId: 'b', gridIndex: -1 },
      { accountId: 'c', gridIndex: -1 },
      { accountId: 'd', gridIndex: -1 },
    ];
    assignGridIndices(players);
    expect(players.map((player) => player.gridIndex)).toEqual([0, 2, 4, 6]);
    players.splice(1, 1);
    assignGridIndices(players);
    expect(players.map((player) => player.gridIndex)).toEqual([0, 2, 4]);
    expect(new Set(players.map((player) => player.gridIndex)).size).toBe(players.length);
    expect(players.every((player) => player.gridIndex < players.length * 2)).toBe(true);
  });

  it('rejects duplicate accounts', () => {
    const players = [{ accountId: 'same', gridIndex: 0 }];
    expect(() => assertAccountAvailable(players, 'same')).toThrow(/已在房间/);
    expect(() => assertAccountAvailable(players, 'other')).not.toThrow();
  });

  it('selects distinct palette colors while colors remain available', () => {
    const used = new Set<number>();
    for (const accountId of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      used.add(colorForAccount(accountId, used));
    }
    expect(used.size).toBe(8);
  });

  it('normalizes a custom room code and rejects unsafe values', () => {
    expect(normalizeRoomCode(' duel88 ')).toBe('DUEL88');
    expect(() => normalizeRoomCode('abc')).toThrow(/4-10/);
    expect(() => normalizeRoomCode('对决01')).toThrow(/4-10/);
  });

  it('claims a custom room code once and releases it on disposal', async () => {
    await claimRoomCode('KSKBL', () => false);
    await expect(claimRoomCode('KSKBL', () => false)).rejects.toThrow(/已被使用/);
    releaseRoomCode('KSKBL');
    await claimRoomCode('KSKBL', () => false);
    releaseRoomCode('KSKBL');
    await expect(claimRoomCode('EXISTS', () => true)).rejects.toThrow(/已被使用/);
  });

  it('unlocks axe defense only after Gonggang raises the axe', () => {
    expect(isActionUnlocked('gonggang', 'base', 'axe_defend', [])).toBe(false);
    expect(isActionUnlocked('gonggang', 'base', 'axe_defend', ['axe_raised'])).toBe(true);
    expect(isActionUnlocked('gonggang', 'base', 'raise_axe', [])).toBe(true);
  });

  it('unlocks Fist only while the player has at least one Energy', () => {
    expect(isActionUnlocked('jiaosila', 'base', 'fist', [], { energy: 0 })).toBe(false);
    expect(isActionUnlocked('jiaosila', 'base', 'fist', [], { energy: 1 })).toBe(true);
  });

  it('requires an active forged blade only for the sovereign blade action', () => {
    expect(isActionUnlocked('regent', 'base', 'sovereign_blade', [{ buffId: 'sovereign_blade_forged', stacks: 1 }])).toBe(false);
    expect(isActionUnlocked('regent', 'base', 'sovereign_blade', [
      { buffId: 'sovereign_blade_forged', stacks: 1 },
      { buffId: 'sovereign_blade_active', stacks: 1 },
    ])).toBe(true);
    expect(isActionUnlocked('regent', 'base', 'sovereign_blade', [
      { buffId: 'sovereign_blade_forged', stacks: 0.5 },
      { buffId: 'sovereign_blade_active', stacks: 1 },
    ])).toBe(true);
    expect(isActionUnlocked('regent', 'base', 'summon_forth', [])).toBe(true);
    expect(isActionUnlocked('regent', 'base', 'summon_forth', [{ buffId: 'sovereign_blade_forged', stacks: 0.5 }])).toBe(true);
    expect(isActionUnlocked('regent', 'base', 'summon_forth', [{ buffId: 'sovereign_blade_forged', stacks: 1 }])).toBe(true);
    expect(isActionUnlocked('regent', 'base', 'summon_forth', [{ buffId: 'sovereign_blade_active', stacks: 1 }])).toBe(true);
    expect(isActionUnlocked('regent', 'base', 'summon_forth', [
      { buffId: 'sovereign_blade_forged', stacks: 2 },
      { buffId: 'sovereign_blade_active', stacks: 1 },
    ])).toBe(true);
  });

  it('unlocks actions granted by player and character buffs', () => {
    expect(isActionUnlocked('default_character', 'base', 'cut', [])).toBe(false);
    expect(isActionUnlocked('default_character', 'base', 'cut', ['cut_granted'])).toBe(true);
    expect(isActionUnlocked('nightmare', 'base', 'nightmare_dash', ['nightmare_dash_ready'])).toBe(true);
    expect(isActionUnlocked('mudrock', 'base', 'slash', ['mud_slash_unlocked'])).toBe(true);
  });

  it('shows Napoleon strategies only for an executable ordered buffer', () => {
    expect(isActionUnlocked('napoleon', 'base', 'nap_strategy_aa', [], {}, '')).toBe(false);
    expect(isActionUnlocked('napoleon', 'base', 'nap_strategy_aa', [], {}, 'A')).toBe(true);
    expect(isActionUnlocked('napoleon', 'base', 'transform', [], {}, 'TATAT')).toBe(false);
    expect(isActionUnlocked('napoleon', 'base', 'transform', ['elba_unlocked'], {}, '')).toBe(true);
  });

  it('ticks finite buffs in inactive character scopes without removing infinite buffs', () => {
    const gonggang = new Map([['timed', { remainingTurns: 2 }], ['infinite', { remainingTurns: 0 }]]);
    const jiaosila = new Map<string, { remainingTurns: number }>();
    const durationFor = (id: string) => id === 'timed' ? 2 : undefined;
    tickScopedBuffs([gonggang, jiaosila], durationFor);
    expect(gonggang.get('timed')?.remainingTurns).toBe(1);
    expect(gonggang.has('infinite')).toBe(true);
    tickScopedBuffs([gonggang, jiaosila], durationFor);
    expect(gonggang.has('timed')).toBe(false);
    expect(gonggang.has('infinite')).toBe(true);
  });
});
