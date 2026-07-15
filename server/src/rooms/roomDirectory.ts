import type { PublicRoomSummary } from '@energy-duel/shared';

export interface RoomListingLike {
  name: string;
  roomId: string;
  clients: number;
  maxClients: number;
  locked?: boolean;
  private?: boolean;
  unlisted?: boolean;
  createdAt?: Date | string;
  metadata?: { hostNickname?: unknown };
}

export function summarizeJoinableRooms(listings: readonly RoomListingLike[]): PublicRoomSummary[] {
  return listings
    .filter((room) => room.name === 'energy_duel_demo'
      && !room.locked
      && !room.private
      && !room.unlisted
      && room.clients > 0
      && room.clients < room.maxClients)
    .map((room) => ({
      roomId: room.roomId,
      hostNickname: typeof room.metadata?.hostNickname === 'string' && room.metadata.hostNickname.trim()
        ? room.metadata.hostNickname.trim()
        : '房主',
      clients: room.clients,
      maxClients: room.maxClients,
      createdAt: normalizeCreatedAt(room.createdAt),
    }))
    .sort((left, right) => right.clients - left.clients || right.createdAt.localeCompare(left.createdAt))
    .slice(0, 50);
}

function normalizeCreatedAt(value: Date | string | undefined): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return '';
}
