import { describe, expect, it } from 'vitest';
import type { SyncedPlayer } from '@energy-duel/shared';
import { playerRoomStatus } from './playerRoomStatus';

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
});
