import { actionById, buffById, characterById } from '@energy-duel/shared';

export interface PositionedPlayer {
  accountId: string;
  gridIndex: number;
}

const PLAYER_COLORS = [0x6d7cff, 0xff6f91, 0x28d7b1, 0xffb84d, 0xb879ff, 0x4db8ff, 0xff7a45, 0x8bd450];
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,10}$/;
const claimedRoomCodes = new Set<string>();

export function normalizeRoomCode(value: unknown): string {
  const roomCode = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!ROOM_CODE_PATTERN.test(roomCode)) throw new Error('房间号需为 4-10 位字母或数字');
  return roomCode;
}

export async function claimRoomCode(roomCode: string, exists: () => boolean | Promise<boolean>): Promise<void> {
  if (claimedRoomCodes.has(roomCode)) throw new Error('房间号已被使用');
  claimedRoomCodes.add(roomCode);
  try {
    if (await exists()) throw new Error('房间号已被使用');
  } catch (reason) {
    claimedRoomCodes.delete(roomCode);
    throw reason;
  }
}

export function releaseRoomCode(roomCode: string): void { claimedRoomCodes.delete(roomCode); }

export function tickScopedBuffs<T extends { remainingTurns: number }>(scopes: Iterable<Map<string, T>>, durationFor: (buffId: string) => number | undefined): void {
  for (const buffs of scopes) {
    for (const [buffId, stored] of buffs) {
      if (durationFor(buffId) === undefined) continue;
      stored.remainingTurns -= 1;
      if (stored.remainingTurns <= 0) buffs.delete(buffId);
    }
  }
}

export function assignGridIndices(players: Iterable<PositionedPlayer>): void {
  let playerIndex = 0;
  for (const player of players) {
    player.gridIndex = playerIndex * 2;
    playerIndex += 1;
  }
}

export function assertAccountAvailable(players: Iterable<PositionedPlayer>, accountId: string): void {
  for (const player of players) {
    if (player.accountId === accountId) throw new Error('该账号已在房间中');
  }
}

export function colorForAccount(accountId: string, usedColors: Set<number>): number {
  let hash = 2166136261;
  for (let index = 0; index < accountId.length; index += 1) {
    hash ^= accountId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const start = (hash >>> 0) % PLAYER_COLORS.length;
  for (let offset = 0; offset < PLAYER_COLORS.length; offset += 1) {
    const color = PLAYER_COLORS[(start + offset) % PLAYER_COLORS.length];
    if (!usedColors.has(color)) return color;
  }
  return PLAYER_COLORS[start];
}

export interface UnlockBuff { buffId: string; stacks: number }

export function isActionUnlocked(characterId: string, formId: string, actionId: string, buffs: Iterable<string | UnlockBuff>, resources: Readonly<Record<string, number>> = {}): boolean {
  const currentBuffs = new Map(Array.from(buffs, (buff) => typeof buff === 'string' ? [buff, 1] : [buff.buffId, buff.stacks]));
  const visibleInTree = characterById.get(characterId)?.forms.find((form) => form.id === formId)?.unlockedActions.includes(actionId) === true;
  const grantedByBuff = Array.from(currentBuffs.keys()).some((buffId) => buffById.get(buffId)?.grantedActionIds?.includes(actionId));
  if (!visibleInTree && !grantedByBuff) return false;
  const requirements = actionById.get(actionId)?.unlockRequirements;
  return (requirements?.allBuffs ?? []).every((buffId) => currentBuffs.has(buffId))
    && (requirements?.noneBuffs ?? []).every((buffId) => !currentBuffs.has(buffId))
    && Object.entries(requirements?.minBuffStacks ?? {}).every(([buffId, stacks]) => (currentBuffs.get(buffId) ?? 0) >= stacks)
    && Object.entries(requirements?.minResources ?? {}).every(([resourceId, amount]) => (resources[resourceId] ?? 0) + 1e-6 >= amount);
}
