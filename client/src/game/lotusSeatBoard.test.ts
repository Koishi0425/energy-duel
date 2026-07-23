import { describe, expect, it } from 'vitest';
import type { SyncedBoardObject } from '@energy-duel/shared';
import { boardUnitSlot, lotusSeatBoardStatus } from './lotusSeatBoard';

const lotus: SyncedBoardObject = {
  objectId: 'lotus_seat:q', definitionId: 'lotus_seat', kind: 'summon', ownerPlayerId: 'q', sourceCharacterId: 'quilon',
  gridIndex: 2, stacks: 1, currentHp: 8, maxHp: 10, remainingTurns: 0, permanent: true,
  originGridIndex: 0, movementDirection: -1, moveSpeed: 1,
  cargo: { a: { energy: 2, charge: 1 }, b: { energy: 1 / 3, charge: 2 } },
};

describe('Lotus Seat board presentation', () => {
  it('shows direction, current speed, and total carried resources', () => {
    expect(lotusSeatBoardStatus(lotus, false)).toBe('逆时针 · 速度 1 · 气 2.33 · 蓄力 3');
    expect(lotusSeatBoardStatus(lotus, true)).toBe('逆 · 速1 · 气2.33 蓄3');
  });

  it('uses the synchronized defaults when an empty seat has not collected cargo', () => {
    expect(lotusSeatBoardStatus({ ...lotus, movementDirection: 1, moveSpeed: undefined, cargo: undefined }, false))
      .toBe('顺时针 · 速度 4 · 气 0 · 蓄力 0');
  });

  it('gives crowded cell occupants distinct, scaled slots', () => {
    const keys = ['object:lotus', 'player:a', 'player:b', 'player:c'];
    const slots = keys.map((key) => boardUnitSlot(keys, key));
    expect(new Set(slots.map(({ x, y }) => `${x},${y}`)).size).toBe(keys.length);
    expect(slots.every((slot) => slot.scale < 1)).toBe(true);
    expect(slots[0].x).toBeLessThan(slots[1].x);
    expect(slots[0].y).toBeLessThan(slots[2].y);
  });
});
