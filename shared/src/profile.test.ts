import { describe, expect, it } from 'vitest';
import { PROFILE_TITLE_RARITIES, profileLevelTier } from './types.js';

describe('profile presentation metadata', () => {
  it('defines all five title rarities with optimized badge art', () => {
    expect(Object.values(PROFILE_TITLE_RARITIES).map((rarity) => rarity.name)).toEqual(['普通', '铜', '银', '金', '彩']);
    for (const rarity of Object.values(PROFILE_TITLE_RARITIES)) expect(rarity.assetUrl).toMatch(/badge\.[a-f0-9]{12}\.webp$/);
  });

  it.each([
    [1, 'normal'], [9, 'normal'],
    [10, 'purple-bronze'], [29, 'purple-bronze'],
    [30, 'brass'], [99, 'brass'],
    [100, 'platinum'], [499, 'platinum'],
    [500, 'rainbow'], [998, 'rainbow'],
    [999, 'diamond'], [1200, 'diamond'],
  ] as const)('maps level %i to %s', (level, tier) => {
    expect(profileLevelTier(level)).toBe(tier);
  });
});
