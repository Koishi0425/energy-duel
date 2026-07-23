export type BoardUnitKind = 'player' | 'summon';

export interface BoardPortraitSize {
  width: number;
  height: number;
  baseHeight: number;
}

export function boardPortraitBaseHeight(playerCount: number): number {
  return playerCount > 12 ? 76 : playerCount > 8 ? 96 : 132;
}

export function boardPortraitSize(sourceWidth: number, sourceHeight: number, playerCount: number, kind: BoardUnitKind): BoardPortraitSize {
  const baseHeight = boardPortraitBaseHeight(playerCount);
  const maxWidth = baseHeight * (kind === 'summon' ? 1.5 : 1.05);
  const maxHeight = baseHeight;
  const safeWidth = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1;
  const safeHeight = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : 1;
  const scale = Math.min(maxWidth / safeWidth, maxHeight / safeHeight);
  return { width: safeWidth * scale, height: safeHeight * scale, baseHeight };
}
