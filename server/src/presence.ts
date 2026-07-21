import type { OnlinePlayerStatus, PublicOnlinePlayerSummary, SessionIdentity } from '@energy-duel/shared';
import type { sessionService } from './services.js';

const ONLINE_TTL_MS = 45_000;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,10}$/;

export interface PresenceUpdate {
  status?: unknown;
  roomId?: unknown;
  roomClients?: unknown;
  roomMaxClients?: unknown;
}

interface PresenceRecord {
  accountId: string;
  username: string;
  status: OnlinePlayerStatus;
  roomId?: string;
  roomClients?: number;
  roomMaxClients?: number;
  updatedAt: number;
}

export class PresenceService {
  private readonly records = new Map<string, PresenceRecord>();

  touch(identity: SessionIdentity, update: PresenceUpdate = {}, now = Date.now()): boolean {
    const status = parseStatus(update.status);
    const roomId = status === 'public_room' && typeof update.roomId === 'string' && ROOM_CODE_PATTERN.test(update.roomId)
      ? update.roomId
      : undefined;
    const next: PresenceRecord = {
      accountId: identity.accountId,
      username: identity.username,
      status,
      roomId,
      roomClients: readCount(update.roomClients),
      roomMaxClients: readCount(update.roomMaxClients),
      updatedAt: now,
    };
    const previous = this.records.get(identity.accountId);
    this.records.set(identity.accountId, next);
    return !previous
      || previous.username !== next.username
      || previous.status !== next.status
      || previous.roomId !== next.roomId
      || previous.roomClients !== next.roomClients
      || previous.roomMaxClients !== next.roomMaxClients;
  }

  remove(accountId: string): boolean {
    return this.records.delete(accountId);
  }

  list(accounts: typeof sessionService, now = Date.now()): PublicOnlinePlayerSummary[] {
    this.prune(now);
    const players: PublicOnlinePlayerSummary[] = [];
    for (const record of this.records.values()) {
      try {
        const profile = accounts.getProfileByAccountId(record.accountId);
        players.push({
          accountId: profile.accountId,
          username: profile.username,
          nickname: profile.nickname,
          avatarUrl: profile.avatarUrl,
          nameplateId: profile.nameplateId,
          titleId: profile.titleId,
          rankId: profile.rankId,
          level: profile.level,
          rating: profile.rating,
          status: record.status,
          roomId: record.roomId,
          roomClients: record.roomClients,
          roomMaxClients: record.roomMaxClients,
          updatedAt: new Date(record.updatedAt).toISOString(),
        });
      } catch {
        this.records.delete(record.accountId);
      }
    }
    return players
      .sort((left, right) => statusRank(left.status) - statusRank(right.status)
        || right.rating - left.rating
        || left.nickname.localeCompare(right.nickname, 'zh-Hans-CN'))
      .slice(0, 80);
  }

  prune(now = Date.now()): boolean {
    let changed = false;
    for (const [accountId, record] of this.records) {
      if (now - record.updatedAt > ONLINE_TTL_MS) {
        this.records.delete(accountId);
        changed = true;
      }
    }
    return changed;
  }
}

export const presenceService = new PresenceService();

function parseStatus(value: unknown): OnlinePlayerStatus {
  if (value === 'public_room' || value === 'training_room') return value;
  return 'idle';
}

function readCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 20 ? value : undefined;
}

function statusRank(status: OnlinePlayerStatus): number {
  if (status === 'idle') return 0;
  if (status === 'public_room') return 1;
  return 2;
}
