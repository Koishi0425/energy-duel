import { describe, expect, it } from 'vitest';
import { circularDistance } from './geometry.js';
import { canExecuteNapoleonStrategy, effectSpeedPriority, gameConfig, isCharacterAvailableInRoomMode, napoleonStrategyFromCommand, validateGameConfig } from './config.js';

describe('game configuration', () => {
  it('loads the checked-in configuration', () => {
    expect(gameConfig.version).toBe(26);
    expect(gameConfig.actions).toHaveLength(109);
    expect(gameConfig.actions.map((action) => action.category)).toContain('base');
    expect(gameConfig.characters.map((character) => character.id)).toEqual(['default_character', 'jiaosila', 'gonggang', 'regent', 'pikachu', 'li_chungang', 'ao', 'nightmare', 'mudrock', 'ye_qingxian', 'napoleon', 'star_god', 'ku', 'inner_guard', 'quilon', 'chimei', 'warrior']);
    expect(gameConfig.characters[0].forms[0].unlockedActions).toEqual(['charge', 'gain_charge', 'defend', 'steal', 'double_steal', 'chop', 'super_defend', 'transform']);
    expect(gameConfig.actions.find((action) => action.id === 'transform')?.cost).toEqual({});
    expect(gameConfig.characters.slice(1).filter((character) => character.id !== 'napoleon').every((character) => character.forms[0].unlockedActions.includes('transform'))).toBe(true);
    expect(gameConfig.characters.every((character) => Object.keys(character.transformationCost).length === 0)).toBe(true);
    expect(gameConfig.buffs.map((buff) => buff.id)).toEqual(expect.arrayContaining(['axe_raised', 'fragile']));
    expect(gameConfig.actions.find((action) => action.id === 'defend')?.defenseBreak).toEqual({ mode: 'persistent', brokenBuffId: 'defend_broken' });
    expect(gameConfig.actions.find((action) => action.id === 'particle_wall')?.defenseBreak).toEqual({ mode: 'recreated' });
    expect(gameConfig.actions.find((action) => action.id === 'collect_light')?.defenseBreak).toEqual({ mode: 'persistent', brokenBuffId: 'collect_light_broken' });
    expect(gameConfig.actions.find((action) => action.id === 'create_star_core')).toMatchObject({ category: 'special', skillLevel: 0, defenseLevel: 3 });
    expect(gameConfig.actions.find((action) => action.id === 'create_star_core')?.defenseBreak).toEqual({ mode: 'recreated' });
    expect(gameConfig.buffs.find((buff) => buff.id === 'transcendence_permanent')?.grantedActionIds).toBeUndefined();
    expect(gameConfig.actions.find((action) => action.id === 'quick_attack')).toMatchObject({ movement: true });
    expect(gameConfig.actions.find((action) => action.id === 'rule_the_world')).toMatchObject({ category: 'attack', skillLevel: 3, damageLevel: 0 });
    expect(gameConfig.actions.find((action) => action.id === 'rule_the_world')?.damageType).toBeUndefined();
    expect(gameConfig.actions.filter((action) => action.cooldownReduction?.buffId === 'shadow_blade_cooldown').map((action) => action.id)).toEqual(['dream_path', 'dark_shelter', 'silent_fear', 'haunting_shadows', 'nightmare_dash']);
    expect(gameConfig.passives.map((passive) => passive.id)).toEqual(expect.arrayContaining(['sword_dao', 'shadow_blade_passive', 'child_of_earth']));
    expect(gameConfig.boardObjects.find((object) => object.id === 'dominion')).toMatchObject({ kind: 'terrain', displayMode: 'marker' });
    expect(gameConfig.boardObjects.find((object) => object.id === 'dream_path')).toMatchObject({ kind: 'terrain', displayMode: 'marker' });
    expect(gameConfig.assets.every((asset) => asset.url.endsWith('.webp') && asset.previewUrl?.endsWith('.webp'))).toBe(true);
    expect(gameConfig.characters.slice(4, 9).every((character) => character.defaultAssetId !== 'portrait_default')).toBe(true);
  });

  it('keeps every base skill after transformation and only appends character skills', () => {
    const base = gameConfig.characters[0].forms[0].unlockedActions.filter((id) => id !== 'transform');
    for (const character of gameConfig.characters.slice(1).filter((character) => character.id !== 'napoleon')) {
      expect(character.forms[0].unlockedActions).toEqual(expect.arrayContaining(base));
    }
    expect(gameConfig.characters.find((character) => character.id === 'napoleon')?.forms[0].unlockedActions.slice(0, 3)).toEqual(['attack_order', 'defense_order', 'tactical_order']);
    expect(gameConfig.actions.filter((action) => action.napoleonSequence)).toHaveLength(29);
    expect(gameConfig.characters.filter((character) => character.id !== 'star_god').every((character) => character.transformations.includes('star_god'))).toBe(true);
    expect(gameConfig.characters.filter((character) => character.id !== 'inner_guard').every((character) => character.transformations.includes('inner_guard'))).toBe(true);
    expect(gameConfig.characters.filter((character) => character.id !== 'chimei').every((character) => character.transformations.includes('chimei'))).toBe(true);
    expect(gameConfig.characters.filter((character) => character.id !== 'warrior').every((character) => character.transformations.includes('warrior'))).toBe(true);
    expect(gameConfig.characters.slice(1).every((character) => !character.transformations.includes('default_character'))).toBe(true);
    expect(gameConfig.characters.find((character) => character.id === 'star_god')?.forms[0].unlockedActions).toContain('hollow_fist');
    expect(gameConfig.characters.find((character) => character.id === 'inner_guard')?.forms[0].unlockedActions).not.toEqual(expect.arrayContaining(['fist', 'slash']));
    expect(gameConfig.characters[1].forms[0].unlockedActions).toContain('atomic_breath');
    expect(gameConfig.characters[2].forms[0].unlockedActions).toContain('raise_axe');
    expect(gameConfig.characters[2].forms[0].unlockedActions).toContain('axe_defend');
    expect(gameConfig.characters[3].forms[0].unlockedActions).toEqual(expect.arrayContaining(['stardust', 'sovereign_blade', 'summon_forth']));
    expect(gameConfig.actions.find((action) => action.id === 'axe_defend')?.unlockRequirements?.allBuffs).toEqual(['axe_raised']);
    expect(gameConfig.actions.find((action) => action.id === 'summon_forth')?.unlockRequirements).toBeUndefined();
    expect(gameConfig.actions.find((action) => action.id === 'three_bodies')?.unlockRequirements).toEqual({
      minBuffStacks: { wuyou_awareness: 7 },
      minResources: { energy: 2 },
      description: '需要无忧觉累计至少 7 点，且当前拥有至少 2 气',
    });
    expect(['hidden_cache', 'winning_hand', 'stardust', 'forge_sword', 'sovereign_blade', 'summon_forth']
      .map((actionId) => gameConfig.actions.find((action) => action.id === actionId)?.speedPriority)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(gameConfig.buffs.find((buff) => buff.id === 'sovereign_blade_forged')?.description).toBe('当前层数即君王之剑的锻造等级。');
    expect(gameConfig.characters.find((character) => character.id === 'chimei')?.forms[0].unlockedActions).toEqual(expect.arrayContaining(['soul_reap', 'soul_capture', 'intimidate', 'deify']));
    expect(gameConfig.resources.find((resource) => resource.id === 'soul')?.characterIds).toEqual(['chimei']);
    expect(gameConfig.characters.find((character) => character.id === 'warrior')?.forms[0].unlockedActions).toEqual(expect.arrayContaining(['bleed', 'taunt', 'tremble', 'molten_fist', 'dismantle', 'bully', 'regain_spirit', 'dominate', 'blood_wall', 'shred', 'body_slam']));
    expect(gameConfig.actions.find((action) => action.id === 'blood_wall')?.cost).toEqual({ energy: 1 });
    expect(gameConfig.actions.find((action) => action.id === 'dismantle')?.repeatAttack).toEqual({ baseHits: 1, targetBuffId: 'vulnerability', extraHitsWhenTargetBuffed: 1 });
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
      (config: any) => { config.actions[0].speedPriority = 5; },
      (config: any) => { config.actions[0].cost = { missing: 1 }; },
      (config: any) => { config.actions[0].target.mode = 'friend'; },
      (config: any) => { config.actions[0].effects = [{ handler: 'eval' }]; },
      (config: any) => { config.actions[0].unlockRequirements = { allBuffs: ['missing'], description: 'test' }; },
      (config: any) => { config.actions[0].defenseBreak = { mode: 'persistent', brokenBuffId: 'missing' }; },
      (config: any) => { config.actions[0].cooldownReduction = { buffId: 'missing', stacks: 1 }; },
    ]) {
      const invalid = structuredClone(gameConfig) as any;
      mutate(invalid);
      expect(() => validateGameConfig(invalid)).toThrow();
    }
  });

  it('uses controlled effect declarations and inherits action speed by default', () => {
    const quickAttack = gameConfig.actions.find((action) => action.id === 'quick_attack')!;
    expect(quickAttack.effects.map((effect) => effect.kind)).toEqual(['movement', 'non_attack']);
    expect(effectSpeedPriority(quickAttack, 'movement')).toBe(2);
    expect(effectSpeedPriority(quickAttack, 'non_attack')).toBe(2);

    const rockfallHammer = gameConfig.actions.find((action) => action.id === 'rockfall_hammer')!;
    expect(effectSpeedPriority(rockfallHammer, 'attack')).toBe(1);
    expect(effectSpeedPriority(rockfallHammer, 'non_attack')).toBe(4);
  });

  it('rejects ambiguous or redundant compound effect timing', () => {
    for (const mutate of [
      (config: any) => { delete config.actions.find((action: any) => action.id === 'quick_attack').effects[0].kind; },
      (config: any) => { config.actions.find((action: any) => action.id === 'quick_attack').effects[0].kind = 'other'; },
      (config: any) => { config.actions.find((action: any) => action.id === 'quick_attack').effects[0].speedPriority = 2; },
      (config: any) => { config.actions.find((action: any) => action.id === 'quick_attack').effects[0].speedPriority = -1; },
      (config: any) => { config.actions.find((action: any) => action.id === 'quick_attack').effects[0].speedPriority = 5; },
    ]) {
      const invalid = structuredClone(gameConfig) as any;
      mutate(invalid);
      expect(() => validateGameConfig(invalid)).toThrow(/effect/);
    }
  });

  it('enables deferred target timing for Stardust and rejects unknown timing values', () => {
    expect(gameConfig.actions.filter((action) => action.target.selectionTiming === 'deferred').map((action) => action.id)).toEqual(['stardust', 'sword_aura', 'open_heaven_gate', 'haunting_shadows', 'deify']);
    const invalid = structuredClone(gameConfig) as any;
    invalid.actions[0].target.selectionTiming = 'late-ish';
    expect(() => validateGameConfig(invalid)).toThrow(/selection timing/);
  });

  it('separates buffered Napoleon strategies from command-triggered strategies', () => {
    expect(canExecuteNapoleonStrategy('AA', 'AA')).toBe(true);
    expect(canExecuteNapoleonStrategy('A', 'AA')).toBe(false);
    expect(napoleonStrategyFromCommand('A', 'A')?.napoleonSequence).toBe('AA');
    expect(napoleonStrategyFromCommand('TTTT', 'T')?.napoleonSequence).toBe('TTTTT');
    expect(napoleonStrategyFromCommand('TAD', 'D')?.napoleonSequence).toBe('DD');
  });

  it('disables Chimei only in standard rooms', () => {
    expect(isCharacterAvailableInRoomMode('chimei', 'standard')).toBe(false);
    expect(isCharacterAvailableInRoomMode('chimei', 'training')).toBe(true);
    expect(isCharacterAvailableInRoomMode('nightmare', 'standard')).toBe(true);
  });

  it('marks Stardust as all-in and assigns special-resource visibility', () => {
    const stardust = gameConfig.actions.find((action) => action.id === 'stardust');
    expect(stardust?.usesAllVariableResource).toBe(true);
    expect(stardust?.multiHit).toBe(true);
    expect(stardust?.variable?.skillLevelPerPower).toBe(1.5);
    expect(stardust?.damageLevel).toBe(1.5);
    expect(gameConfig.resources.find((resource) => resource.id === 'energy')?.alwaysVisible).toBe(true);
    expect(gameConfig.resources.find((resource) => resource.id === 'stars')?.characterIds).toEqual(['regent']);
    expect(gameConfig.buffs.find((buff) => buff.id === 'tactical_advantage')?.durationTurns).toBeUndefined();
  });

  it('rejects invalid split skill and damage levels', () => {
    for (const mutate of [
      (config: any) => { config.actions[0].skillLevel = -0.5; },
      (config: any) => { config.actions[0].damageLevel = Number.NaN; },
      (config: any) => { config.actions.find((action: any) => action.variable).variable.skillLevelPerPower = -1; },
    ]) {
      const invalid = structuredClone(gameConfig) as any;
      mutate(invalid);
      expect(() => validateGameConfig(invalid)).toThrow();
    }
  });

  it('accepts multi-hit only for power-sized repeated attacks', () => {
    for (const mutate of [
      (config: any) => { config.actions[0].multiHit = true; },
      (config: any) => { config.actions.find((action: any) => action.id === 'stardust').multiHit = false; },
    ]) {
      const invalid = structuredClone(gameConfig) as any;
      mutate(invalid);
      expect(() => validateGameConfig(invalid)).toThrow(/multi-hit/);
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
