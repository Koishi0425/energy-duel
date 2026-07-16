import { MapSchema } from '@colyseus/schema';
import { describe, expect, it } from 'vitest';
import { BuffState, EnergyDuelRoom, PlayerState } from './EnergyDuelRoom.js';

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

  it('preserves fractional Regent forge stacks across character switches', () => {
    const room = new EnergyDuelRoom() as any;
    const current = new MapSchema<BuffState>();
    const forged = new BuffState(); forged.instanceId = 'p:sovereign_blade_forged'; forged.buffId = 'sovereign_blade_forged'; forged.stacks = 2.5; forged.sourcePlayerId = 'p';
    current.set(forged.instanceId, forged);
    room.captureActiveBuffs('p', 'regent', new Set(['sovereign_blade_forged']), current, { sovereign_blade_forged: 2.5 });
    const away = new MapSchema<BuffState>();
    room.syncActiveBuffs('p', 'jiaosila', away);
    expect(away.size).toBe(0);
    const restored = new MapSchema<BuffState>();
    room.syncActiveBuffs('p', 'regent', restored);
    expect(restored.get('p:sovereign_blade_forged')?.stacks).toBe(2.5);
  });
});

describe('EnergyDuelRoom training actors', () => {
  it('creates a server-owned dummy controlled by the room host', () => {
    const room = new EnergyDuelRoom() as any;
    const host = new PlayerState(); host.playerId = 'host'; host.controllerPlayerId = 'host'; host.accountId = 'account';
    room.state.players.set(host.playerId, host);
    const dummy = room.createTrainingDummy('host') as PlayerState;
    expect(dummy.isTrainingDummy).toBe(true);
    expect(dummy.controllerPlayerId).toBe('host');
    expect(dummy.playerId).not.toBe(host.playerId);
    expect(dummy.resources.size).toBeGreaterThan(0);
    expect(Array.from(room.state.players.values(), (player: PlayerState) => player.gridIndex)).toEqual([0, 2]);
  });

  it('authorizes only the synchronized controller to act for a dummy', () => {
    const room = new EnergyDuelRoom() as any; room.state.roomMode = 'training';
    const dummy = new PlayerState(); dummy.playerId = 'dummy'; dummy.controllerPlayerId = 'host'; room.state.players.set(dummy.playerId, dummy);
    expect(room.authorizedActor({ sessionId: 'host' }, 'dummy')).toBe(dummy);
    expect(room.authorizedActor({ sessionId: 'intruder' }, 'dummy')).toBeUndefined();
  });
});
