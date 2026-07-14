export interface PositionedPlayer {
  accountId: string;
  gridIndex: number;
}

const PLAYER_COLORS = [0x6d7cff, 0xff6f91, 0x28d7b1, 0xffb84d, 0xb879ff, 0x4db8ff, 0xff7a45, 0x8bd450];

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
