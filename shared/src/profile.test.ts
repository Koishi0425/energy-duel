import { describe, expect, it } from 'vitest';
import { experienceRequiredForLevel, experienceRequiredForNextLevel, MAX_EXPERIENCE_PER_LEVEL, MAX_PROFILE_LEVEL, PROFILE_TITLE_RARITIES, profileLevelForExperience, profileLevelTier } from './types.js';

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

  it('uses the repaired cumulative experience curve', () => {
    expect(experienceRequiredForLevel(1)).toBe(0);
    expect(experienceRequiredForLevel(10)).toBe(571);
    expect(experienceRequiredForLevel(30)).toBe(2_711);
    expect(experienceRequiredForLevel(100)).toBe(19_651);
    expect(experienceRequiredForLevel(500)).toBe(398_083);
    expect(experienceRequiredForLevel(999)).toBe(1_146_583);
    expect(experienceRequiredForLevel(1_000)).toBe(experienceRequiredForLevel(MAX_PROFILE_LEVEL));
  });

  it('caps late-game level costs without flattening the early curve', () => {
    expect(experienceRequiredForNextLevel(10)).toBeLessThan(MAX_EXPERIENCE_PER_LEVEL);
    expect(experienceRequiredForNextLevel(483)).toBe(1_497);
    expect(experienceRequiredForNextLevel(484)).toBe(MAX_EXPERIENCE_PER_LEVEL);
    expect(experienceRequiredForNextLevel(900)).toBe(MAX_EXPERIENCE_PER_LEVEL);
    expect(experienceRequiredForNextLevel(MAX_PROFILE_LEVEL)).toBe(0);
    expect(experienceRequiredForLevel(901) - experienceRequiredForLevel(900)).toBe(MAX_EXPERIENCE_PER_LEVEL);
  });

  it('keeps every level cost monotonic and below the cap before the plateau', () => {
    const earlyCosts = Array.from({ length: 483 }, (_, index) => experienceRequiredForNextLevel(index + 1));
    expect(earlyCosts.every((cost) => cost > 0 && cost < MAX_EXPERIENCE_PER_LEVEL)).toBe(true);
    for (let index = 1; index < earlyCosts.length; index += 1) expect(earlyCosts[index]).toBeGreaterThanOrEqual(earlyCosts[index - 1]);
    for (let level = 484; level < MAX_PROFILE_LEVEL; level += 1) expect(experienceRequiredForNextLevel(level)).toBe(MAX_EXPERIENCE_PER_LEVEL);
  });

  it('derives levels at exact threshold boundaries', () => {
    expect(profileLevelForExperience(570)).toBe(9);
    expect(profileLevelForExperience(571)).toBe(10);
    expect(profileLevelForExperience(19_650)).toBe(99);
    expect(profileLevelForExperience(19_651)).toBe(100);
    expect(profileLevelForExperience(99_999_999)).toBe(MAX_PROFILE_LEVEL);
  });
});
