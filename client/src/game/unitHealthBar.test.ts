import { describe, expect, it } from 'vitest';
import { HEALTH_BAR_COLORS, unitHealthBarModel } from './unitHealthBar';

describe('unitHealthBarModel', () => {
  it('uses one segment per health state and turns the final state red', () => {
    expect(unitHealthBarModel(3, 3, 4, 0).segmentColors).toEqual([
      HEALTH_BAR_COLORS.healthy, HEALTH_BAR_COLORS.healthy, HEALTH_BAR_COLORS.healthy,
    ]);
    expect(unitHealthBarModel(1, 3, 4, 0).segmentColors).toEqual([
      HEALTH_BAR_COLORS.nearDeath, HEALTH_BAR_COLORS.empty, HEALTH_BAR_COLORS.empty,
    ]);
  });

  it('keeps a one-state base character green while healthy', () => {
    expect(unitHealthBarModel(1, 1, 4, 0).segmentColors).toEqual([
      HEALTH_BAR_COLORS.healthy,
    ]);
  });

  it('keeps fractional armor and scales down for crowded boards', () => {
    const model = unitHealthBarModel(2, 2, 13, 2.5);
    expect(model).toMatchObject({ width: 40, height: 6, gap: 1, armor: 2.5 });
  });
});
