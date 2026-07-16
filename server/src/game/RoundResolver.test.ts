import { describe, expect, it } from 'vitest';
import { buildResolutionSteps, resolveRound, validateAction, type CombatPlayer, type SubmittedAction } from './RoundResolver.js';

function roster(...players: Array<[string, number]>): Map<string, CombatPlayer> {
  return new Map(players.map(([id, energy]) => [id, {
    id, nickname: id.toUpperCase(), resources: { energy }, currentHp: 1, maxHp: 1, alive: true,
  }]));
}

function actions(...items: Array<[string, SubmittedAction]>): Map<string, SubmittedAction> {
  return new Map(items);
}

describe('RoundResolver JSON-driven actions', () => {
  it('charges one energy', () => {
    const players = roster(['a', 0], ['b', 0]);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')?.resources.energy).toBe(1);
  });

  it('steals the generated energy from a charging target', () => {
    const players = roster(['a', 0], ['b', 0]);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'steal', targetId: 'a' }]));
    expect(players.get('a')?.resources.energy).toBe(0);
    expect(players.get('b')?.resources.energy).toBe(1);
  });

  it('logs actions that produce no practical effect', () => {
    const players = roster(['a', 0], ['b', 0]);
    const result = resolveRound(players, actions(['a', { actionId: 'steal', targetId: 'b' }], ['b', { actionId: 'gain_charge' }]));
    expect(result.summary).toContain('A 的凹没有从 B 获得气：目标本回合没有出气。');
  });

  it('chop cancels every steal and eliminates the stealers', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    resolveRound(players, actions(
      ['a', { actionId: 'charge' }], ['b', { actionId: 'steal', targetId: 'a' }], ['c', { actionId: 'chop' }],
    ));
    expect(players.get('a')?.resources.energy).toBe(1);
    expect(players.get('b')?.alive).toBe(false);
    expect(players.get('b')?.currentHp).toBe(0);
    expect(resolveRound(roster(['x', 0], ['y', 0]), actions(['x', { actionId: 'chop' }], ['y', { actionId: 'steal', targetId: 'x' }])).summary[0]).toContain('X：剁');
  });

  it('chop counters both steal variants and always shifts exactly one health state', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    for (const id of ['a', 'b']) { players.get(id)!.currentHp = 2; players.get(id)!.maxHp = 2; }
    resolveRound(players, actions(
      ['a', { actionId: 'steal', targetId: 'c' }],
      ['b', { actionId: 'double_steal', targetIds: ['c', 'c'] }],
      ['c', { actionId: 'chop' }],
    ));
    expect(players.get('a')!.currentHp).toBe(1);
    expect(players.get('b')!.currentHp).toBe(1);
    expect(players.get('a')!.alive).toBe(true);
    expect(players.get('b')!.alive).toBe(true);
  });

  it('defense blocks wave and super defense blocks all attacks', () => {
    const players = roster(['a', 2], ['b', 0], ['c', 1], ['d', 3]);
    resolveRound(players, actions(
      ['a', { actionId: 'wave', targetId: 'b' }], ['b', { actionId: 'defend' }],
      ['c', { actionId: 'super_defend' }], ['d', { actionId: 'hangup' }],
    ));
    expect(players.get('b')?.alive).toBe(false);
    expect(players.get('c')?.alive).toBe(true);
    expect(players.get('a')?.alive).toBe(false);
  });

  it('hangup costs three and ignores normal defense', () => {
    const players = roster(['a', 3], ['b', 0]);
    resolveRound(players, actions(['a', { actionId: 'hangup' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')?.resources.energy).toBe(0);
    expect(players.get('b')?.alive).toBe(false);
  });

  it('emits structured performance metrics without parsing combat text', () => {
    const attack = resolveRound(roster(['a', 3], ['b', 0]), actions(['a', { actionId: 'hangup' }], ['b', { actionId: 'defend' }]));
    expect(attack.performance.a).toMatchObject({ damageStatesDealt: 1, eliminations: 1 });
    const defense = resolveRound(roster(['a', 0], ['b', 0]), actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'super_defend' }]));
    expect(defense.performance.b.successfulDefenses).toBe(1);
  });

  it('validates configuration costs and target modes', () => {
    const players = roster(['a', 0], ['b', 0]);
    expect(() => validateAction(players.get('a')!, { actionId: 'wave', targetId: 'b' }, players)).toThrow(/资源不足/);
    expect(() => validateAction(players.get('a')!, { actionId: 'steal' }, players)).toThrow(/请选择/);
    expect(() => validateAction(players.get('a')!, { actionId: 'defend', targetId: 'b' }, players)).toThrow(/不接受/);
  });

  it('orders the client timeline by speed then player id and pairs mutual targets', () => {
    const steps = buildResolutionSteps(actions(
      ['b', { actionId: 'fist', targetId: 'a' }],
      ['a', { actionId: 'fist', targetId: 'b' }],
      ['c', { actionId: 'super_defend' }],
    ));
    expect(steps[0].actors[0].playerId).toBe('c');
    expect(steps[1].actors.map((actor) => actor.playerId)).toEqual(['a', 'b']);
  });

  it('pairs a targetless action with the next action at the same speed', () => {
    const steps = buildResolutionSteps(actions(
      ['a', { actionId: 'charge' }],
      ['b', { actionId: 'fist', targetId: 'c' }],
      ['c', { actionId: 'fist', targetId: 'b' }],
    ));
    expect(steps[0].actors.map((actor) => actor.playerId)).toEqual(['a', 'b']);
    expect(steps[1].actors.map((actor) => actor.playerId)).toEqual(['c']);
  });

  it('groups a defense with its incoming attack even when their speeds differ', () => {
    const steps = buildResolutionSteps(actions(['a', { actionId: 'defend' }], ['b', { actionId: 'fist', targetId: 'a' }]));
    expect(steps).toHaveLength(1);
    expect(steps[0].actors.map((actor) => actor.playerId)).toEqual(['a', 'b']);
  });

  it('limits attacks below level three to one health-state shift', () => {
    const players = roster(['a', 1], ['b', 0]);
    const target = players.get('b')!;
    target.currentHp = 2;
    target.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'slash', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.alive).toBe(true);
    expect(target.currentHp).toBe(1);
    const result = resolveRound(roster(['c', 0], ['d', 0]), actions(['c', { actionId: 'fist', targetId: 'd' }], ['d', { actionId: 'charge' }]));
    expect(result.summary.join('\n')).toMatch(/D 进入死亡状态/);
  });

  it('breaks an equal-or-lower block before applying the attack', () => {
    const players = roster(['a', 2], ['b', 0]);
    players.get('a')!.resources.charge = 1;
    const target = players.get('b')!;
    target.currentHp = 2;
    target.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'atomic_breath', targetId: 'b' }], ['b', { actionId: 'axe_defend' }]));
    expect(target.alive).toBe(true);
    expect(target.currentHp).toBe(1);
    expect(target.resources.energy).toBe(2);
    expect(target.buffs?.has('axe_defend_broken')).toBe(true);
  });

  it('keeps a persistent defense broken at level zero', () => {
    const players = roster(['a', 0], ['b', 0]);
    players.get('a')!.resources.stars = 4;
    const target = players.get('b')!;
    target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'stardust', power: 4, targetIds: ['b', 'b', 'b', 'b'] }],
      ['b', { actionId: 'defend' }],
    ));
    expect(target.currentHp).toBe(2);
    expect(target.buffs?.has('defend_broken')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(target.currentHp).toBe(1);
  });

  it('recreates a generated defense on its next use', () => {
    const players = roster(['a', 0], ['b', 0]);
    players.get('a')!.resources.stars = 4;
    players.get('b')!.resources.stars = 4;
    const target = players.get('b')!;
    target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'stardust', power: 4, targetIds: ['b', 'b', 'b', 'b'] }],
      ['b', { actionId: 'particle_wall', power: 1 }],
    ));
    expect(target.currentHp).toBe(2);
    expect(target.buffs?.has('defend_broken')).not.toBe(true);
    resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'particle_wall', power: 1 }]));
    expect(target.currentHp).toBe(2);
  });

  it('uses level zero after a defense breaks within the same round', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    players.get('a')!.resources.stars = 4;
    const target = players.get('b')!;
    target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'stardust', power: 4, targetIds: ['b', 'b', 'b', 'b'] }],
      ['b', { actionId: 'defend' }],
      ['c', { actionId: 'fist', targetId: 'b' }],
    ));
    expect(target.currentHp).toBe(1);
  });

  it('cancels equal-level attacks and applies only the positive level difference', () => {
    const equalPlayers = roster(['a', 1], ['b', 1]);
    resolveRound(equalPlayers, actions(['a', { actionId: 'wave', targetId: 'b' }], ['b', { actionId: 'wave', targetId: 'a' }]));
    expect(equalPlayers.get('a')?.alive).toBe(true);
    expect(equalPlayers.get('b')?.alive).toBe(true);

    const differentPlayers = roster(['a', 1], ['b', 1]);
    for (const player of differentPlayers.values()) { player.currentHp = 2; player.maxHp = 2; }
    resolveRound(differentPlayers, actions(['a', { actionId: 'slash', targetId: 'b' }], ['b', { actionId: 'wave', targetId: 'a' }]));
    expect(differentPlayers.get('a')?.currentHp).toBe(2);
    expect(differentPlayers.get('b')?.currentHp).toBe(1);
  });

  it('does not use a targeted action level against an unrelated attacker', () => {
    const players = roster(['a', 1], ['b', 0], ['c', 0]);
    players.get('a')!.currentHp = players.get('a')!.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'slash', targetId: 'b' }],
      ['b', { actionId: 'defend' }],
      ['c', { actionId: 'fist', targetId: 'a' }],
    ));
    expect(players.get('a')!.currentHp).toBe(1);
  });

  it('writes explicit health-state names in attack logs', () => {
    const players = roster(['a', 0], ['b', 0]);
    players.get('a')!.nickname = 'momoi';
    players.get('b')!.nickname = 'Glmg';
    players.get('b')!.currentHp = 2;
    players.get('b')!.maxHp = 2;
    const result = resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(result.summary).toContain('momoi 的拳（0.5级）对 Glmg 的气（0级）：等级差 0.5，Glmg 进入濒死状态。');
  });

  it('switches characters repeatedly using target-configured free transformation costs', () => {
    const players = roster(['a', 0], ['b', 0]);
    const actor = players.get('a')!;
    actor.characterId = 'gonggang'; actor.currentFormId = 'base'; actor.buffs = new Set(['axe_raised']);
    resolveRound(players, actions(['a', { actionId: 'transform', transformCharacterId: 'jiaosila' }], ['b', { actionId: 'defend' }]));
    expect(actor.characterId).toBe('jiaosila');
    expect(actor.resources.energy).toBe(0);
    resolveRound(players, actions(['a', { actionId: 'transform', transformCharacterId: 'gonggang' }], ['b', { actionId: 'defend' }]));
    expect(actor.characterId).toBe('gonggang');
  });

  it('accepts repeated targets for the planned double steal', () => {
    const players = roster(['a', 0], ['b', 0]);
    expect(() => validateAction(players.get('a')!, { actionId: 'double_steal', targetIds: ['b', 'b'] }, players)).not.toThrow();
  });

  it('grants Regent stars only on the first transformation of a game', () => {
    const players = roster(['a', 0], ['b', 0]);
    const actor = players.get('a')!;
    actor.characterId = 'default_character';
    resolveRound(players, actions(['a', { actionId: 'transform', transformCharacterId: 'regent' }], ['b', { actionId: 'defend' }]));
    expect(actor.resources.stars).toBe(3);
    expect(actor.buffs?.has('regent_claimed')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'transform', transformCharacterId: 'jiaosila' }], ['b', { actionId: 'defend' }]));
    resolveRound(players, actions(['a', { actionId: 'transform', transformCharacterId: 'regent' }], ['b', { actionId: 'defend' }]));
    expect(actor.resources.stars).toBe(3);
  });

  it('validates and pays variable particle-wall costs', () => {
    const players = roster(['a', 0], ['b', 0]);
    players.get('a')!.resources.stars = 4;
    expect(() => validateAction(players.get('a')!, { actionId: 'particle_wall' }, players)).toThrow(/参数/);
    expect(() => validateAction(players.get('a')!, { actionId: 'particle_wall', power: 3 }, players)).toThrow(/资源不足/);
    resolveRound(players, actions(['a', { actionId: 'particle_wall', power: 2 }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')!.resources.stars).toBe(0);
  });

  it('resolves Regent star income and collect-light defense', () => {
    const players = roster(['a', 1], ['b', 1]);
    players.get('a')!.resources.stars = 0;
    resolveRound(players, actions(['a', { actionId: 'hidden_cache' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')!.resources.stars).toBe(1);
    expect(players.get('a')!.buffs?.has('hidden_cache_pending')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'collect_light' }], ['b', { actionId: 'wave', targetId: 'a' }]));
    expect(players.get('a')!.resources.stars).toBe(2);
  });

  it('keeps Collect Light broken at level zero after an equal attack', () => {
    const players = roster(['a', 0], ['b', 0]);
    players.get('a')!.resources.stars = 4;
    const target = players.get('b')!; target.characterId = 'regent'; target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'stardust', power: 4, targetIds: ['b', 'b', 'b', 'b'] }],
      ['b', { actionId: 'collect_light' }],
    ));
    expect(target.currentHp).toBe(2);
    expect(target.resources.stars).toBe(1);
    expect(target.buffs?.has('collect_light_broken')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'collect_light' }]));
    expect(target.currentHp).toBe(1);
  });

  it('uses afterglow as a minimum next-round action level', () => {
    const players = roster(['a', 1], ['b', 1]);
    for (const player of players.values()) { player.currentHp = 2; player.maxHp = 2; }
    resolveRound(players, actions(['a', { actionId: 'iridescence' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')!.buffs?.has('iridescence_afterglow')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'slash', targetId: 'a' }]));
    expect(players.get('a')!.currentHp).toBe(2);
    expect(players.get('a')!.buffs?.has('iridescence_afterglow')).toBe(false);
  });

  it('forges, fires and locks the sovereign blade', () => {
    const players = roster(['a', 2], ['b', 0]);
    const actor = players.get('a')!;
    actor.resources.stars = 4;
    resolveRound(players, actions(['a', { actionId: 'forge_sword' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffStacks?.sovereign_blade_forged).toBe(3);
    expect(actor.buffs?.has('sovereign_blade_active')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'sovereign_blade', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffs?.has('sovereign_blade_active')).toBe(false);
  });

  it('lets Summon Forth create or refresh an already active sovereign blade', () => {
    const players = roster(['a', 1], ['b', 0]);
    const actor = players.get('a')!;
    resolveRound(players, actions(['a', { actionId: 'summon_forth' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffStacks?.sovereign_blade_forged).toBe(0.5);
    expect(actor.buffs?.has('sovereign_blade_active')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'summon_forth' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffStacks?.sovereign_blade_forged).toBe(1);
    expect(actor.buffs?.has('sovereign_blade_active')).toBe(true);
  });

  it('aggregates repeated deferred Stardust allocations per target', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    players.get('a')!.resources.stars = 4;
    for (const player of players.values()) { player.currentHp = 2; player.maxHp = 2; }
    const stardust = { actionId: 'stardust', power: 4, targetIds: ['b', 'b', 'c', 'c'] };
    expect(() => validateAction(players.get('a')!, stardust, players)).not.toThrow();
    const result = resolveRound(players, actions(['a', stardust], ['b', { actionId: 'charge' }], ['c', { actionId: 'defend' }]));
    expect(players.get('a')!.resources.stars).toBe(0);
    expect(players.get('b')!.currentHp).toBe(1);
    expect(players.get('c')!.currentHp).toBe(2);
    expect(result.summary[0]).toContain('B ×2、C ×2');
  });

  it('requires Stardust to spend every currently held Star', () => {
    const players = roster(['a', 0], ['b', 0]);
    players.get('a')!.resources.stars = 3;
    expect(() => validateAction(players.get('a')!, { actionId: 'stardust', power: 2 }, players)).toThrow(/全部/);
    expect(() => validateAction(players.get('a')!, { actionId: 'stardust', power: 3 }, players)).not.toThrow();
  });

  it('supports Li Chungang fractional slash costs and deferred sword attacks', () => {
    const players = roster(['a', 1], ['b', 0]);
    players.get('a')!.characterId = 'li_chungang';
    expect(() => validateAction(players.get('a')!, { actionId: 'sword_aura' }, players)).not.toThrow();
    resolveRound(players, actions(['a', { actionId: 'slash', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')!.resources.energy).toBeCloseTo(2 / 3);
  });

  it('moves Quick Attack to an adjacent empty cell and preserves its free Ten Volt', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    players.get('a')!.characterId = 'pikachu'; players.get('a')!.resources.charge = 2;
    players.get('a')!.gridIndex = 0; players.get('b')!.gridIndex = 2; players.get('c')!.gridIndex = 4;
    resolveRound(players, actions(['a', { actionId: 'quick_attack', targetGridIndex: 1 }], ['b', { actionId: 'defend' }], ['c', { actionId: 'defend' }]));
    expect(players.get('a')!.gridIndex).toBe(1);
    expect(players.get('a')!.buffs?.has('quick_attack_ready')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'ten_volt' }], ['b', { actionId: 'defend' }], ['c', { actionId: 'defend' }]));
    expect(players.get('a')!.resources.charge).toBe(1);
    expect(players.get('a')!.buffs?.has('quick_attack_ready')).toBe(false);
  });

  it('grants Cut globally when Ao transforms and upgrades mastery from resource actions', () => {
    const players = roster(['a', 0], ['b', 0]);
    resolveRound(players, actions(['a', { actionId: 'transform', transformCharacterId: 'ao' }], ['b', { actionId: 'defend' }]));
    expect(Array.from(players.values()).every((player) => player.buffs?.has('cut_granted'))).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')!.buffStacks?.ao_mastery).toBe(1);
  });

  it('validates mixed-resource payment and resets Ao mastery after the divine art', () => {
    const players = roster(['a', 3], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'ao'; actor.resources.charge = 2; actor.buffs = new Set(['ao_mastery']); actor.buffStacks = { ao_mastery: 2 };
    const divine = { actionId: 'aoao_divine', targetId: 'b', resourceSpend: { energy: 2, charge: 1 } };
    expect(() => validateAction(actor, divine, players)).not.toThrow();
    resolveRound(players, actions(['a', divine], ['b', { actionId: 'defend' }]));
    expect(actor.resources.energy).toBe(1); expect(actor.resources.charge).toBe(1); expect(actor.buffs?.has('ao_mastery')).toBe(false);
  });

  it('requires integer mixed resource payment for Aoao Divine Art', () => {
    const players = roster(['a', 2], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'ao'; actor.resources.charge = 2; actor.buffs = new Set(['ao_mastery']); actor.buffStacks = { ao_mastery: 3 };
    expect(() => validateAction(actor, { actionId: 'aoao_divine', targetId: 'b', resourceSpend: { energy: 1 / 3, charge: 5 / 3 } }, players)).toThrow(/整数/);
    const divine = { actionId: 'aoao_divine', targetId: 'b', resourceSpend: { energy: 1, charge: 1 } };
    expect(() => validateAction(actor, divine, players)).not.toThrow();
    resolveRound(players, actions(['a', divine], ['b', { actionId: 'defend' }]));
    expect(actor.resources.energy).toBe(1);
    expect(actor.resources.charge).toBe(1);
  });

  it('arms one deferred Nightmare dash and blinds only the other players', () => {
    const players = roster(['a', 1], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'nightmare'; actor.resources.charge = 3; actor.gridIndex = 0; players.get('b')!.gridIndex = 2;
    resolveRound(players, actions(['a', { actionId: 'haunting_shadows', targetIds: [] }], ['b', { actionId: 'defend' }]));
    expect(actor.buffs?.has('nightmare_dash_ready')).toBe(true);
    expect(actor.buffs?.has('darkness')).toBe(false);
    expect(players.get('b')!.buffs?.has('darkness')).toBe(true);
  });

  it('reduces Shadow Blade cooldown only after Nightmare-specific actions', () => {
    const players = roster(['a', 10], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'nightmare'; actor.buffs = new Set(['shadow_blade_cooldown']); actor.buffStacks = { shadow_blade_cooldown: 4 };
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffStacks?.shadow_blade_cooldown).toBe(4);
    for (const remaining of [3, 2, 1]) {
      resolveRound(players, actions(['a', { actionId: 'dream_path', targetId: 'b' }], ['b', { actionId: 'defend' }]));
      expect(actor.buffStacks?.shadow_blade_cooldown).toBe(remaining);
    }
    resolveRound(players, actions(['a', { actionId: 'dream_path', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffs?.has('shadow_blade_cooldown')).toBe(false);
  });

  it('uses Silent Fear level only for control and deals no damage', () => {
    const players = roster(['a', 1], ['b', 0]); const actor = players.get('a')!; const target = players.get('b')!;
    actor.characterId = 'nightmare'; actor.resources.charge = 1; target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'silent_fear', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(target.currentHp).toBe(2);
    expect(target.buffs?.has('fear')).toBe(true);
  });

  it('makes sleeping Mudrock untargetable and wakes early with a refund and slash', () => {
    const players = roster(['a', 3], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'mudrock'; actor.currentHp = actor.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'filthy_bloodline' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffs?.has('sleeping')).toBe(true);
    expect(() => validateAction(players.get('b')!, { actionId: 'fist', targetId: 'a' }, players)).toThrow(/可被选中/);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffs?.has('sleeping')).toBe(false); expect(actor.buffs?.has('mud_awakened')).toBe(true); expect(actor.resources.energy).toBe(3);
  });
});
