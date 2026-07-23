import { describe, expect, it } from 'vitest';
import { readSyncedBoardObjects, readSyncedPlayers } from './roomState';

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
      buffs: { values: () => [{ instanceId: 'frozen-1', buffId: 'frozen', stacks: 1, remainingTurns: 2, permanent: false, sourcePlayerId: 'player-2' }][Symbol.iterator]() },
      learnedActionIds: ['bully'], learnedPassiveIds: ['tear_passive'],
    };
    const result = readSyncedPlayers([player]);
    expect(result[0].resources.energy.current).toBe(2);
    expect(result[0].buffs[0].buffId).toBe('frozen');
    expect(result[0].controllerPlayerId).toBe('player-1');
    expect(result[0].isTrainingDummy).toBe(false);
    expect(result[0].learnedActionIds).toEqual(['bully']);
    expect(result[0].learnedPassiveIds).toEqual(['tear_passive']);
  });

  it('normalizes synchronized terrain and summon objects', () => {
    const objects = [{ objectId: 'dominion:a:2', definitionId: 'dominion', kind: 'terrain' as const, ownerPlayerId: 'a', sourceCharacterId: 'inner_guard', gridIndex: 2, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true }];
    expect(readSyncedBoardObjects(objects)).toEqual([{ ...objects[0], originGridIndex: 2, movementDirection: 0, moveSpeed: 0, cargo: {} }]);
  });

  it('normalizes synchronized Lotus cargo maps', () => {
    const cargo = new Map([['player-2', { energy: 2, charge: 1 }]]);
    const object = { objectId: 'lotus_seat:player-1', definitionId: 'lotus_seat', kind: 'summon' as const, ownerPlayerId: 'player-1', sourceCharacterId: 'quilon', gridIndex: 3, stacks: 1, currentHp: 8, maxHp: 10, remainingTurns: 0, permanent: true, originGridIndex: 0, movementDirection: 1 as const, moveSpeed: 1, cargo };
    expect(readSyncedBoardObjects([object as never])[0].cargo).toEqual({ 'player-2': { energy: 2, charge: 1 } });
  });
});
