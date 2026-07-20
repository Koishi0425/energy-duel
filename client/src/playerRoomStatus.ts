import type { GamePhase, SyncedPlayer } from '@energy-duel/shared';

export type PlayerRoomStatusTone = 'positive' | 'waiting' | 'offline' | 'neutral';
export interface PlayerRoomStatus { label: string; tone: PlayerRoomStatusTone }

export function playerRoomStatus(player: SyncedPlayer, phase: GamePhase): PlayerRoomStatus {
  if (!player.connected) return { label: '已断线', tone: 'offline' };
  if (phase === 'waiting') {
    if (player.isTrainingDummy) return { label: '练习角色', tone: 'neutral' };
    return player.ready ? { label: '已准备', tone: 'positive' } : { label: '未准备', tone: 'waiting' };
  }
  if (phase === 'choosing') return player.submitted
    ? { label: '已出招', tone: 'positive' }
    : { label: player.alive ? '思考中' : '已淘汰', tone: player.alive ? 'waiting' : 'neutral' };
  if (phase === 'deferred') return { label: player.alive ? '后发确认' : '已淘汰', tone: player.alive ? 'waiting' : 'neutral' };
  if (phase === 'resolving') return { label: player.alive ? '结算中' : '已淘汰', tone: 'neutral' };
  return player.resultConfirmed
    ? { label: '已确认结算', tone: 'positive' }
    : { label: '待确认结算', tone: 'waiting' };
}
