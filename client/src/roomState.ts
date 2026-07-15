import type { SyncedBuff, SyncedPlayer, SyncedResource } from '@energy-duel/shared';

interface RawResourceCollection { values(): IterableIterator<SyncedResource> }
interface RawBuffCollection { values(): IterableIterator<SyncedBuff> }

export interface RawSyncedPlayer extends Omit<SyncedPlayer, 'resources' | 'buffs'> {
  resources?: RawResourceCollection;
  buffs?: RawBuffCollection;
}

export function readSyncedPlayers(players: Iterable<RawSyncedPlayer> | undefined): SyncedPlayer[] {
  if (!players) return [];
  return Array.from(players, (player) => {
    const resources = Object.fromEntries(
      Array.from(player.resources?.values() ?? [], (resource) => [resource.resourceId, {
        resourceId: resource.resourceId,
        current: resource.current,
        max: resource.max,
      }]),
    );
    const buffs = Array.from(player.buffs?.values() ?? [], (buff) => ({
      instanceId: buff.instanceId,
      buffId: buff.buffId,
      stacks: buff.stacks,
      remainingTurns: buff.remainingTurns,
      sourcePlayerId: buff.sourcePlayerId,
    }));
    return {
      accountId: player.accountId,
      playerId: player.playerId,
      username: player.username,
      nickname: player.nickname,
      gridIndex: player.gridIndex,
      color: player.color,
      ready: player.ready,
      alive: player.alive,
      currentHp: player.currentHp,
      maxHp: player.maxHp,
      characterId: player.characterId,
      currentFormId: player.currentFormId,
      resources,
      buffs,
      submitted: player.submitted,
      connected: player.connected,
      resultConfirmed: player.resultConfirmed ?? false,
    };
  });
}
