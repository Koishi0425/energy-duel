import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from '@energy-duel/shared';
import { PresenceService } from './presence.js';
import type { sessionService } from './services.js';

const profile = (accountId: string, nickname: string): PlayerProfile => ({
  accountId,
  username: nickname.toLowerCase(),
  nickname,
  nameplateId: 'standard',
  titleId: 'novice',
  rankId: 'unranked',
  level: 3,
  experience: 120,
  experienceForNextLevel: 180,
  rating: nickname === 'Alpha' ? 90 : 40,
  ratingBest35: 0,
  ratingRecent15: 0,
  unlockedNameplateIds: ['standard'],
  unlockedTitleIds: ['novice'],
  stats: { totalGames: 0, wins: 0, losses: 0, draws: 0, currentWinStreak: 0, bestWinStreak: 0 },
  createdAt: '2026-07-21T00:00:00.000Z',
});

const accounts = {
  getProfileByAccountId(accountId: string) {
    if (accountId === 'a') return profile('a', 'Alpha');
    if (accountId === 'b') return profile('b', 'Beta');
    throw new Error('missing');
  },
} as typeof sessionService;

describe('presence service', () => {
  it('reports only visible presence changes', () => {
    const service = new PresenceService();
    const identity = { accountId: 'a', username: 'alpha' };
    expect(service.touch(identity, { status: 'idle' }, 1000)).toBe(true);
    expect(service.touch(identity, { status: 'idle' }, 2000)).toBe(false);
    expect(service.touch(identity, { status: 'public_room', roomId: 'DUEL88', roomClients: 1, roomMaxClients: 20 }, 3000)).toBe(true);
    expect(service.remove(identity.accountId)).toBe(true);
    expect(service.remove(identity.accountId)).toBe(false);
  });

  it('publishes recent online players with sanitized room status', () => {
    const service = new PresenceService();
    service.touch({ accountId: 'a', username: 'alpha' }, { status: 'public_room', roomId: 'DUEL88', roomClients: 3, roomMaxClients: 20 }, 1000);
    service.touch({ accountId: 'b', username: 'beta' }, { status: 'training_room', roomId: 'SECRET', roomClients: 2, roomMaxClients: 20 }, 1000);
    const result = service.list(accounts, 2000);
    expect(result.map((player) => player.nickname)).toEqual(['Alpha', 'Beta']);
    expect(result[0]).toMatchObject({ status: 'public_room', roomId: 'DUEL88', roomClients: 3, roomMaxClients: 20 });
    expect(result[1]).toMatchObject({ status: 'training_room', roomId: undefined });
  });

  it('drops stale and deleted-account presences', () => {
    const service = new PresenceService();
    service.touch({ accountId: 'a', username: 'alpha' }, { status: 'idle' }, 1000);
    service.touch({ accountId: 'missing', username: 'missing' }, { status: 'idle' }, 46_500);
    expect(service.list(accounts, 47_000).map((player) => player.accountId)).toEqual([]);
  });
});
