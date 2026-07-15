import { describe, expect, it } from 'vitest';
import { summarizeJoinableRooms, type RoomListingLike } from './roomDirectory.js';

const room = (overrides: Partial<RoomListingLike> = {}): RoomListingLike => ({
  name: 'energy_duel_demo', roomId: 'ROOM1', clients: 1, maxClients: 20,
  createdAt: new Date('2026-07-15T00:00:00.000Z'), metadata: { hostNickname: '娇斯拉' },
  ...overrides,
});

describe('room directory', () => {
  it('only exposes joinable waiting rooms', () => {
    expect(summarizeJoinableRooms([
      room(), room({ roomId: 'LOCKED', locked: true }), room({ roomId: 'FULL', clients: 20 }),
      room({ roomId: 'EMPTY', clients: 0 }), room({ roomId: 'PRIVATE', private: true }),
      room({ roomId: 'OTHER', name: 'another_room' }),
    ]).map((entry) => entry.roomId)).toEqual(['ROOM1']);
  });

  it('sorts populated rooms first and sanitizes public metadata', () => {
    const result = summarizeJoinableRooms([
      room({ roomId: 'ONE', clients: 1, metadata: { hostNickname: '' } }),
      room({ roomId: 'THREE', clients: 3, metadata: { hostNickname: ' 贡刚 ' } }),
    ]);
    expect(result.map((entry) => entry.roomId)).toEqual(['THREE', 'ONE']);
    expect(result.map((entry) => entry.hostNickname)).toEqual(['贡刚', '房主']);
  });
});
