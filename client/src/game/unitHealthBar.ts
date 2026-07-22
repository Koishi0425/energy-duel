export const HEALTH_BAR_COLORS = {
  healthy: 0x35c96f,
  nearDeath: 0xf05252,
  empty: 0x171d2d,
  border: 0x080b13,
  armor: 0xc7ced8,
} as const;

export interface UnitHealthBarModel {
  width: number;
  height: number;
  gap: number;
  segmentColors: number[];
  armor: number;
}

export function unitHealthBarModel(currentHp: number, maxHp: number, playerCount: number, armor: number): UnitHealthBarModel {
  const safeMaxHp = Math.max(1, Math.trunc(maxHp));
  const safeCurrentHp = Math.max(0, Math.min(safeMaxHp, Math.trunc(currentHp)));
  const activeColor = safeMaxHp > 1 && safeCurrentHp === 1
    ? HEALTH_BAR_COLORS.nearDeath
    : HEALTH_BAR_COLORS.healthy;
  return {
    width: playerCount > 12 ? 40 : playerCount > 8 ? 48 : 62,
    height: playerCount > 12 ? 6 : playerCount > 8 ? 7 : 8,
    gap: playerCount > 12 ? 1 : 2,
    segmentColors: Array.from({ length: safeMaxHp }, (_, index) => index < safeCurrentHp ? activeColor : HEALTH_BAR_COLORS.empty),
    armor: Math.max(0, armor),
  };
}
