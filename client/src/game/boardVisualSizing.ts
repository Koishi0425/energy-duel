export type BoardUnitKind = 'player' | 'summon';

export interface BoardPortraitSize {
  width: number;
  height: number;
  baseHeight: number;
}

export function boardPortraitBaseHeight(playerCount: number): number {
  return playerCount > 12 ? 50 : playerCount > 8 ? 62 : 86;
}

export function boardPortraitSize(sourceWidth: number, sourceHeight: number, playerCount: number, kind: BoardUnitKind): BoardPortraitSize {
  const baseHeight = boardPortraitBaseHeight(playerCount);
  const maxWidth = baseHeight * (kind === 'summon' ? 1.3 : 0.9);
  const maxHeight = baseHeight;
  const safeWidth = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1;
  const safeHeight = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : 1;
  const scale = Math.min(maxWidth / safeWidth, maxHeight / safeHeight);
  return { width: safeWidth * scale, height: safeHeight * scale, baseHeight };
}
