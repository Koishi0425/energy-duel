import { describe, expect, it } from 'vitest';
import type { SyncedPlayer } from '@energy-duel/shared';
import { canSponsorControlledActor, playerRoomStatus } from './playerRoomStatus';

const player = { connected: true, ready: false, submitted: false, alive: true, resultConfirmed: false, isTrainingDummy: false } as SyncedPlayer;

describe('playerRoomStatus', () => {
  it('shows readiness, action submission and result confirmation by phase', () => {
    expect(playerRoomStatus(player, 'waiting').label).toBe('未准备');
    expect(playerRoomStatus({ ...player, ready: true }, 'waiting').label).toBe('已准备');
    expect(playerRoomStatus({ ...player, submitted: true }, 'choosing').label).toBe('已出招');
    expect(playerRoomStatus({ ...player, resultConfirmed: true }, 'finished').label).toBe('已确认结算');
  });

  it('always gives disconnected state priority', () => {
    expect(playerRoomStatus({ ...player, connected: false, ready: true }, 'waiting')).toEqual({ label: '已断线', tone: 'offline' });
    expect(playerRoomStatus({ ...player, connected: false, resultConfirmed: true }, 'finished').label).toBe('已断线');
  });

  it('offers Soul sponsorship only for a player converted by the current Chimei', () => {
    const chimei = { ...player, playerId: 'chimei', characterId: 'chimei', buffs: [] } as SyncedPlayer;
    const converted = { ...player, playerId: 'target', buffs: [{ buffId: 'converted', sourcePlayerId: 'chimei' }] } as SyncedPlayer;
    const trainingDummy = { ...player, playerId: 'dummy', isTrainingDummy: true, buffs: [] } as SyncedPlayer;
    expect(canSponsorControlledActor(chimei, converted)).toBe(true);
    expect(canSponsorControlledActor(chimei, trainingDummy)).toBe(false);
    expect(canSponsorControlledActor({ ...chimei, characterId: 'warrior' }, converted)).toBe(false);
  });
});
