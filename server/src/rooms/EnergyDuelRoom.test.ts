import { MapSchema } from '@colyseus/schema';
import { describe, expect, it } from 'vitest';
import { BuffState, EnergyDuelRoom } from './EnergyDuelRoom.js';

describe('EnergyDuelRoom character-scoped buffs', () => {
  it('hides a Gonggang buff after switching away and restores it after switching back', () => {
    const room = new EnergyDuelRoom() as any;
    const current = new MapSchema<BuffState>();
    const axe = new BuffState(); axe.instanceId = 'p:axe_raised'; axe.buffId = 'axe_raised'; axe.sourcePlayerId = 'p';
    current.set(axe.instanceId, axe);
    room.captureActiveBuffs('p', 'gonggang', new Set(['axe_raised']), current);
    room.tickStoredBuffs('p');

    const jiaosila = new MapSchema<BuffState>();
    room.syncActiveBuffs('p', 'jiaosila', jiaosila);
    expect(jiaosila.size).toBe(0);
    room.captureActiveBuffs('p', 'jiaosila', new Set(), jiaosila);

    const gonggang = new MapSchema<BuffState>();
    room.syncActiveBuffs('p', 'gonggang', gonggang);
    expect(Array.from(gonggang.values(), (buff) => buff.buffId)).toEqual(['axe_raised']);
  });
});
