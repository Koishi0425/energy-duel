import { describe, expect, it } from 'vitest';
import { readSyncedPlayers } from './roomState';

describe('readSyncedPlayers', () => {
  it('returns an empty roster before the first Colyseus state frame', () => {
    expect(readSyncedPlayers(undefined)).toEqual([]);
  });

  it('normalizes synchronized resource and buff maps', () => {
    const player = {
      playerId: 'player-1', accountId: 'account-1', username: 'PlayerOne', nickname: '一号玩家',
      gridIndex: 0, color: 0x6d7cff, ready: true, alive: true, currentHp: 1, maxHp: 1,
      characterId: 'default_character', currentFormId: 'base', submitted: false, connected: true, resultConfirmed: false,
      resources: { values: () => [{ resourceId: 'energy', current: 2, max: 0 }][Symbol.iterator]() },
      buffs: { values: () => [{ instanceId: 'frozen-1', buffId: 'frozen', stacks: 1, remainingTurns: 2, sourcePlayerId: 'player-2' }][Symbol.iterator]() },
    };
    const result = readSyncedPlayers([player]);
    expect(result[0].resources.energy.current).toBe(2);
    expect(result[0].buffs[0].buffId).toBe('frozen');
  });
});
