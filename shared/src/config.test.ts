import { describe, expect, it } from 'vitest';
import { circularDistance } from './geometry.js';
import { gameConfig, validateGameConfig } from './config.js';

describe('game configuration', () => {
  it('loads the checked-in configuration', () => {
    expect(gameConfig.actions).toHaveLength(7);
    expect(gameConfig.characters[0].forms[0].unlockedActions).toHaveLength(7);
  });

  it('rejects duplicate ids and invalid references', () => {
    expect(() => validateGameConfig({ ...gameConfig, actions: [...gameConfig.actions, gameConfig.actions[0]] })).toThrow(/Duplicate/);
    const invalid = structuredClone(gameConfig);
    invalid.characters[0].forms[0].defaultAssetId = 'missing';
    expect(() => validateGameConfig(invalid)).toThrow(/missing asset/);
  });

  it('rejects invalid categories, costs, target modes and handlers', () => {
    for (const mutate of [
      (config: any) => { config.actions[0].category = 'other'; },
      (config: any) => { config.actions[0].cost = { missing: 1 }; },
      (config: any) => { config.actions[0].target.mode = 'friend'; },
      (config: any) => { config.actions[0].effects = [{ handler: 'eval' }]; },
    ]) {
      const invalid = structuredClone(gameConfig) as any;
      mutate(invalid);
      expect(() => validateGameConfig(invalid)).toThrow();
    }
  });
});

describe('circularDistance', () => {
  it('uses the shortest path across the seam', () => {
    expect(circularDistance(0, 7, 8)).toBe(1);
    expect(circularDistance(1, 5, 8)).toBe(4);
  });

  it('rejects invalid grids and indices', () => {
    expect(() => circularDistance(0, 0, 0)).toThrow(RangeError);
    expect(() => circularDistance(-1, 0, 8)).toThrow(RangeError);
  });
});
