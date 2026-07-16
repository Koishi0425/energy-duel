import { describe, expect, it } from 'vitest';
import { circularDistance } from './geometry.js';
import { gameConfig, validateGameConfig } from './config.js';

describe('game configuration', () => {
  it('loads the checked-in configuration', () => {
    expect(gameConfig.version).toBe(7);
    expect(gameConfig.actions).toHaveLength(43);
    expect(gameConfig.actions.map((action) => action.category)).toContain('base');
    expect(gameConfig.characters.map((character) => character.id)).toEqual(['default_character', 'jiaosila', 'gonggang', 'regent', 'pikachu', 'li_chungang', 'ao', 'nightmare', 'mudrock']);
    expect(gameConfig.characters[0].forms[0].unlockedActions).toEqual(['charge', 'gain_charge', 'defend', 'steal', 'double_steal', 'chop', 'super_defend', 'transform']);
    expect(gameConfig.actions.find((action) => action.id === 'transform')?.cost).toEqual({});
    expect(gameConfig.characters.slice(1).every((character) => character.forms[0].unlockedActions.includes('transform'))).toBe(true);
    expect(gameConfig.characters.every((character) => Object.keys(character.transformationCost).length === 0)).toBe(true);
    expect(gameConfig.buffs.map((buff) => buff.id)).toEqual(expect.arrayContaining(['axe_raised', 'fragile']));
    expect(gameConfig.passives.map((passive) => passive.id)).toEqual(expect.arrayContaining(['sword_dao', 'shadow_blade_passive', 'child_of_earth']));
  });

  it('keeps every base skill after transformation and only appends character skills', () => {
    const base = gameConfig.characters[0].forms[0].unlockedActions.filter((id) => id !== 'transform');
    for (const character of gameConfig.characters.slice(1)) {
      expect(character.forms[0].unlockedActions).toEqual(expect.arrayContaining(base));
    }
    expect(gameConfig.characters[1].forms[0].unlockedActions).toContain('atomic_breath');
    expect(gameConfig.characters[2].forms[0].unlockedActions).toContain('raise_axe');
    expect(gameConfig.characters[2].forms[0].unlockedActions).toContain('axe_defend');
    expect(gameConfig.characters[3].forms[0].unlockedActions).toEqual(expect.arrayContaining(['stardust', 'sovereign_blade', 'summon_forth']));
    expect(gameConfig.actions.find((action) => action.id === 'axe_defend')?.unlockRequirements?.allBuffs).toEqual(['axe_raised']);
    expect(gameConfig.actions.find((action) => action.id === 'summon_forth')?.unlockRequirements).toBeUndefined();
  });

  it('rejects duplicate ids and invalid references', () => {
    expect(() => validateGameConfig({ ...gameConfig, actions: [...gameConfig.actions, gameConfig.actions[0]] })).toThrow(/Duplicate/);
    const invalid = structuredClone(gameConfig);
    invalid.characters[0].forms[0].defaultAssetId = 'missing';
    expect(() => validateGameConfig(invalid)).toThrow(/missing asset/);
    const invalidCost = structuredClone(gameConfig);
    invalidCost.characters[0].transformationCost = { missing: 1 };
    expect(() => validateGameConfig(invalidCost)).toThrow(/transformation cost/);
  });

  it('rejects invalid categories, costs, target modes and handlers', () => {
    for (const mutate of [
      (config: any) => { config.actions[0].category = 'other'; },
      (config: any) => { config.actions[0].cost = { missing: 1 }; },
      (config: any) => { config.actions[0].target.mode = 'friend'; },
      (config: any) => { config.actions[0].effects = [{ handler: 'eval' }]; },
      (config: any) => { config.actions[0].unlockRequirements = { allBuffs: ['missing'], description: 'test' }; },
    ]) {
      const invalid = structuredClone(gameConfig) as any;
      mutate(invalid);
      expect(() => validateGameConfig(invalid)).toThrow();
    }
  });

  it('enables deferred target timing for Stardust and rejects unknown timing values', () => {
    expect(gameConfig.actions.filter((action) => action.target.selectionTiming === 'deferred').map((action) => action.id)).toEqual(['stardust', 'sword_aura', 'open_heaven_gate', 'haunting_shadows']);
    const invalid = structuredClone(gameConfig) as any;
    invalid.actions[0].target.selectionTiming = 'late-ish';
    expect(() => validateGameConfig(invalid)).toThrow(/selection timing/);
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
