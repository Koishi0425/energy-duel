import { describe, expect, it } from 'vitest';
import { assertAccountAvailable, assignGridIndices, colorForAccount } from './roomSupport.js';

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
});
