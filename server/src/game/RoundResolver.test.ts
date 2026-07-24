import { describe, expect, it } from 'vitest';
import { actionById, type ActionDefinition } from '@energy-duel/shared';
import { buildResolutionSteps, resolveRound, validateAction, type CombatBoardObject, type CombatPlayer, type SubmittedAction } from './RoundResolver.js';

function roster(...players: Array<[string, number]>): Map<string, CombatPlayer> {
  return new Map(players.map(([id, energy]) => [id, {
    id, nickname: id.toUpperCase(), resources: { energy }, currentHp: 1, maxHp: 1, alive: true,
  }]));
}

function actions(...items: Array<[string, SubmittedAction]>): Map<string, SubmittedAction> {
  return new Map(items);
}

function dominion(ownerPlayerId: string, gridIndex: number): CombatBoardObject {
  return {
    objectId: `dominion:${ownerPlayerId}:${gridIndex}`,
    definitionId: 'dominion',
    kind: 'terrain',
    ownerPlayerId,
    sourceCharacterId: 'inner_guard',
    gridIndex,
    stacks: 1,
    currentHp: 0,
    maxHp: 0,
    remainingTurns: 0,
    permanent: true,
  };
}

describe('RoundResolver JSON-driven actions', () => {
  it('charges one energy', () => {
    const players = roster(['a', 0], ['b', 0]);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')?.resources.energy).toBe(1);
  });

  it('suppresses the target charge and grants energy to the successful stealer', () => {
    const players = roster(['a', 0], ['b', 0]);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'steal', targetId: 'a' }]));
    expect(players.get('a')?.resources.energy).toBe(0);
    expect(players.get('b')?.resources.energy).toBe(1);
  });

  it('lets repeated Double Steal allocations deduct existing energy without going negative', () => {
    const players = roster(['a', 0], ['b', 0]);
    const result = resolveRound(players, actions(
      ['a', { actionId: 'double_steal', targetIds: ['b', 'b'] }],
      ['b', { actionId: 'charge' }],
    ));
    expect(players.get('a')?.resources.energy).toBe(2);
    expect(players.get('b')?.resources.energy).toBe(0);
    expect(result.summary.filter((line) => line.includes('A 的紫翼双凹对 B 生效，获得 1 气')).length).toBe(2);
    expect(result.summary).toContain('A 的紫翼双凹对 B 生效，获得 1 气，并倒扣 B 1 气。');
    expect(result.summary).toContain('B 使用气，但本回合获得的 1 气被凹阻止。');

    const stocked = roster(['a', 0], ['b', 2]);
    resolveRound(stocked, actions(
      ['a', { actionId: 'double_steal', targetIds: ['b', 'b'] }],
      ['b', { actionId: 'charge' }],
    ));
    expect(stocked.get('a')?.resources.energy).toBe(2);
    expect(stocked.get('b')?.resources.energy).toBe(1);
  });

  it('rewards every player who steals from the same charging target without repeated overdrafts', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    const result = resolveRound(players, actions(
      ['a', { actionId: 'steal', targetId: 'c' }],
      ['b', { actionId: 'steal', targetId: 'c' }],
      ['c', { actionId: 'charge' }],
    ));
    expect(players.get('a')?.resources.energy).toBe(1);
    expect(players.get('b')?.resources.energy).toBe(1);
    expect(players.get('c')?.resources.energy).toBe(0);
    expect(result.summary.join('\n')).not.toContain('倒扣 C');
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

  it('orders the client timeline by speed then player id without merging authoritative action steps', () => {
    const steps = buildResolutionSteps(actions(
      ['b', { actionId: 'fist', targetId: 'a' }],
      ['a', { actionId: 'fist', targetId: 'b' }],
      ['c', { actionId: 'super_defend' }],
    ));
    expect(steps[0].actors[0].playerId).toBe('c');
    expect(steps.slice(1).map((step) => step.actors[0].playerId)).toEqual(['a', 'b']);
  });

  it('keeps targetless actions as their own timeline steps', () => {
    const steps = buildResolutionSteps(actions(
      ['a', { actionId: 'charge' }],
      ['b', { actionId: 'fist', targetId: 'c' }],
      ['c', { actionId: 'fist', targetId: 'b' }],
    ));
    expect(steps.map((step) => step.actors[0].playerId)).toEqual(['a', 'b', 'c']);
  });

  it('keeps defenses and incoming attacks at their own authoritative speeds', () => {
    const steps = buildResolutionSteps(actions(['a', { actionId: 'defend' }], ['b', { actionId: 'fist', targetId: 'a' }]));
    expect(steps).toHaveLength(2);
    expect(steps.map((step) => step.actors[0].playerId)).toEqual(['a', 'b']);
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

  it('does not combine Stardust hits against a defense', () => {
    const players = roster(['a', 0], ['b', 0]);
    players.get('a')!.resources.stars = 4;
    const target = players.get('b')!;
    target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'stardust', power: 4, targetIds: ['b', 'b', 'b', 'b'] }],
      ['b', { actionId: 'defend' }],
    ));
    expect(target.currentHp).toBe(2);
    expect(target.buffs?.has('defend_broken')).not.toBe(true);
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

  it('combines Stardust effect levels, resolves every hit, and caps sub-three health loss per round', () => {
    const players = roster(['a', 0], ['b', 1]);
    players.get('a')!.resources.stars = 4;
    const target = players.get('b')!;
    target.currentHp = target.maxHp = 2;
    const result = resolveRound(players, actions(
      ['a', { actionId: 'stardust', power: 4, targetIds: ['b', 'b', 'b', 'b'] }],
      ['b', { actionId: 'wave', targetId: 'a' }],
    ));
    expect(target.alive).toBe(true);
    expect(target.currentHp).toBe(1);
    expect(result.summary.filter((line) => line.includes('结算第'))).toHaveLength(4);
  });

  it('resolves multi-hit behavior from configuration instead of the effect id', () => {
    const template = actionById.get('stardust')!;
    const genericMultiHit = structuredClone(template) as ActionDefinition;
    genericMultiHit.id = 'test_multi_hit';
    genericMultiHit.name = '测试多段攻击';
    genericMultiHit.effects = [{ handler: 'wave' }];
    actionById.set(genericMultiHit.id, genericMultiHit);
    try {
      const players = roster(['a', 0], ['b', 1]);
      const target = players.get('b')!;
      target.currentHp = target.maxHp = 2;
      const result = resolveRound(players, actions(
        ['a', { actionId: genericMultiHit.id, power: 4, targetIds: ['b', 'b', 'b', 'b'] }],
        ['b', { actionId: 'wave', targetId: 'a' }],
      ));
      expect(target.currentHp).toBe(1);
      expect(result.summary.join('\n')).toContain('测试多段攻击');
      expect(result.summary.join('\n')).toContain('合并 4 段效果等级');
    } finally {
      actionById.delete(genericMultiHit.id);
    }
  });

  it('does not combine multi-hit effect levels when the target attack is unrelated', () => {
    const players = roster(['a', 0], ['b', 1], ['c', 0]);
    players.get('a')!.resources.stars = 2;
    const target = players.get('b')!;
    target.currentHp = target.maxHp = 2;
    const result = resolveRound(players, actions(
      ['a', { actionId: 'stardust', power: 2, targetIds: ['b', 'b'] }],
      ['b', { actionId: 'wave', targetId: 'c' }],
      ['c', { actionId: 'charge' }],
    ));
    expect(result.summary.join('\n')).not.toContain('合并 2 段效果等级');
  });

  it.each([3, 4, 5])('keeps %i-hit Stardust effect success independent from losing per-hit damage', (stars) => {
    const players = roster(['a', 0], ['b', 1]);
    const attacker = players.get('a')!;
    const target = players.get('b')!;
    attacker.resources.stars = stars;
    target.characterId = 'napoleon';
    target.buffs = new Set(['tactical_advantage']);
    target.buffStacks = { tactical_advantage: 6 };
    target.currentHp = target.maxHp = 2;
    const result = resolveRound(players, actions(
      ['a', { actionId: 'stardust', power: stars, targetIds: Array(stars).fill('b') }],
      ['b', { actionId: 'wave', targetId: 'a' }],
    ));
    expect(target.currentHp).toBe(2);
    expect(target.alive).toBe(true);
    expect(result.summary.join('\n')).toContain('附带效果成功');
    expect(result.summary.join('\n')).toContain('伤害 1.5 未高于');
  });

  it('resolves every retained multi-hit segment against updated armor', () => {
    const players = roster(['a', 0], ['b', 1]);
    players.get('a')!.resources.stars = 3;
    const target = players.get('b')!;
    target.currentHp = target.maxHp = 2;
    target.buffs = new Set(['armor']); target.buffStacks = { armor: 2 };
    const result = resolveRound(players, actions(
      ['a', { actionId: 'stardust', power: 3, targetIds: ['b', 'b', 'b'] }],
      ['b', { actionId: 'wave', targetId: 'a' }],
    ));
    expect(target.currentHp).toBe(2);
    expect(target.buffStacks?.armor).toBe(0.5);
  });

  it('takes only the highest effective damage from repeated sources in one round', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 1]);
    const target = players.get('b')!;
    target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'fist', targetId: 'b' }],
      ['b', { actionId: 'charge' }],
      ['c', { actionId: 'slash', targetId: 'b' }],
    ));
    expect(target.currentHp).toBe(1);
    expect(target.alive).toBe(true);
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
    expect(result.summary.join('\n')).toContain('效果 0.5 / 伤害 0.5');
    expect(result.summary.join('\n')).toContain('Glmg 进入濒死状态');
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

  it('does not combine Stardust hits to break Collect Light', () => {
    const players = roster(['a', 0], ['b', 0]);
    players.get('a')!.resources.stars = 4;
    const target = players.get('b')!; target.characterId = 'regent'; target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'stardust', power: 4, targetIds: ['b', 'b', 'b', 'b'] }],
      ['b', { actionId: 'collect_light' }],
    ));
    expect(target.currentHp).toBe(2);
    expect(target.resources.stars).toBe(1);
    expect(target.buffs?.has('collect_light_broken')).not.toBe(true);
    resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'collect_light' }]));
    expect(target.currentHp).toBe(2);
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
    actor.resources.stars = 8;
    resolveRound(players, actions(['a', { actionId: 'forge_sword' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffStacks?.sovereign_blade_forged).toBe(3);
    expect(actor.buffs?.has('sovereign_blade_active')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'forge_sword' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffStacks?.sovereign_blade_forged).toBe(6);
    resolveRound(players, actions(['a', { actionId: 'sovereign_blade', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffs?.has('sovereign_blade_active')).toBe(false);
    expect(players.get('b')!.alive).toBe(false);
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

  it('keeps repeated Stardust allocations separate outside attack clashes', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    players.get('a')!.resources.stars = 4;
    for (const player of players.values()) { player.currentHp = 2; player.maxHp = 2; }
    const stardust = { actionId: 'stardust', power: 4, targetIds: ['b', 'b', 'c', 'c'] };
    expect(() => validateAction(players.get('a')!, stardust, players)).not.toThrow();
    const result = resolveRound(players, actions(['a', stardust], ['b', { actionId: 'charge' }], ['c', { actionId: 'defend' }]));
    expect(players.get('a')!.resources.stars).toBe(0);
    expect(players.get('b')!.currentHp).toBe(1);
    expect(players.get('b')!.alive).toBe(true);
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

  it('moves Quick Attack onto an occupied cell with at least three players and preserves its free Ten Volt', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    players.get('a')!.characterId = 'pikachu'; players.get('a')!.resources.charge = 2;
    players.get('a')!.gridIndex = 0; players.get('b')!.gridIndex = 2; players.get('c')!.gridIndex = 4;
    expect(() => validateAction(players.get('a')!, { actionId: 'quick_attack', targetGridIndex: 3 }, players)).not.toThrow();
    expect(() => validateAction(players.get('a')!, { actionId: 'quick_attack', targetGridIndex: 2 }, players)).not.toThrow();
    resolveRound(players, actions(['a', { actionId: 'quick_attack', targetGridIndex: 2 }], ['b', { actionId: 'defend' }], ['c', { actionId: 'defend' }]));
    expect(players.get('a')!.gridIndex).toBe(2);
    expect(players.get('b')!.gridIndex).toBe(2);
    expect(players.get('a')!.buffs?.has('quick_attack_ready')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'ten_volt' }], ['b', { actionId: 'defend' }], ['c', { actionId: 'defend' }]));
    expect(players.get('a')!.resources.charge).toBe(1);
    expect(players.get('a')!.buffs?.has('quick_attack_ready')).toBe(false);
  });

  it('lets same-speed movement dodge an ordinary attack aimed at the original cell', () => {
    const players = roster(['a', 2], ['b', 0], ['c', 0]);
    players.get('a')!.gridIndex = 0; players.get('b')!.gridIndex = 2; players.get('c')!.gridIndex = 4;
    players.get('b')!.characterId = 'pikachu'; players.get('b')!.resources.charge = 1;
    resolveRound(players, actions(
      ['a', { actionId: 'hollow_fist', targetId: 'b' }],
      ['b', { actionId: 'quick_attack', targetGridIndex: 3 }],
      ['c', { actionId: 'defend' }],
    ));
    expect(players.get('b')!.gridIndex).toBe(3);
    expect(players.get('b')!.alive).toBe(true);
  });

  it('makes fast low damage and slow high damage attacks hurt each other', () => {
    const players = roster(['a', 0], ['b', 1]);
    for (const player of players.values()) { player.currentHp = 2; player.maxHp = 2; }
    const fast = players.get('a')!;
    fast.characterId = 'napoleon'; fast.buffs = new Set(['napoleon_speed']); fast.buffStacks = { napoleon_speed: 1 };
    players.get('b')!.characterId = 'gonggang';

    resolveRound(players, actions(
      ['a', { actionId: 'attack_order', targetId: 'b' }],
      ['b', { actionId: 'slash', targetId: 'a' }],
    ));

    expect(players.get('a')!.currentHp).toBe(1);
    expect(players.get('b')!.currentHp).toBe(1);
  });

  it('lets a fast high damage attack hurt a slow low damage attacker alone', () => {
    const players = roster(['a', 0], ['b', 0]);
    for (const player of players.values()) { player.currentHp = 2; player.maxHp = 2; player.characterId = 'napoleon'; }
    const fast = players.get('a')!;
    fast.commandBuffer = 'AA'; fast.buffs = new Set(['napoleon_speed']); fast.buffStacks = { napoleon_speed: 1 };

    resolveRound(players, actions(
      ['a', { actionId: 'nap_strategy_aa', targetId: 'b' }],
      ['b', { actionId: 'attack_order', targetId: 'a' }],
    ));

    expect(players.get('a')!.currentHp).toBe(2);
    expect(players.get('b')!.currentHp).toBe(1);
  });

  it('ignores speed when attacks with equal damage levels clash', () => {
    const players = roster(['a', 0], ['b', 0]);
    for (const player of players.values()) { player.currentHp = 2; player.maxHp = 2; player.characterId = 'napoleon'; }
    const fast = players.get('a')!;
    fast.buffs = new Set(['napoleon_speed']); fast.buffStacks = { napoleon_speed: 1 };

    resolveRound(players, actions(
      ['a', { actionId: 'attack_order', targetId: 'b' }],
      ['b', { actionId: 'attack_order', targetId: 'a' }],
    ));

    expect(players.get('a')!.currentHp).toBe(2);
    expect(players.get('b')!.currentHp).toBe(2);
  });

  it('lets a faster attack bypass a slower active defense at full damage', () => {
    const players = roster(['a', 0], ['b', 0]);
    for (const player of players.values()) { player.currentHp = 2; player.maxHp = 2; }
    const fast = players.get('a')!;
    fast.characterId = 'napoleon'; fast.commandBuffer = 'AA'; fast.buffs = new Set(['napoleon_speed']); fast.buffStacks = { napoleon_speed: 2 };

    resolveRound(players, actions(
      ['a', { actionId: 'nap_strategy_aa', targetId: 'b' }],
      ['b', { actionId: 'defend' }],
    ));

    expect(players.get('b')!.currentHp).toBe(1);
  });

  it('keeps ordinary attacks single-target when multiple players share the snapshotted cell', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    players.get('a')!.gridIndex = 0; players.get('b')!.gridIndex = 2; players.get('c')!.gridIndex = 2;
    resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'charge' }], ['c', { actionId: 'charge' }]));
    expect(players.get('b')!.alive).toBe(false);
    expect(players.get('c')!.alive).toBe(true);
  });

  it('lets another occupant inherit an ordinary attack after its original target moves away', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    players.get('a')!.gridIndex = 0; players.get('b')!.gridIndex = 2; players.get('c')!.gridIndex = 2;
    players.get('b')!.characterId = 'pikachu'; players.get('b')!.resources.charge = 1;
    resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'quick_attack', targetGridIndex: 3 }], ['c', { actionId: 'charge' }]));
    expect(players.get('b')!.alive).toBe(true);
    expect(players.get('c')!.alive).toBe(false);
  });

  it('does not dodge a faster attack or a locked attack by moving', () => {
    const faster = roster(['a', 2], ['b', 0], ['c', 0]);
    faster.get('a')!.gridIndex = 0; faster.get('b')!.gridIndex = 2; faster.get('c')!.gridIndex = 4;
    faster.get('a')!.characterId = 'napoleon'; faster.get('a')!.buffs = new Set(['napoleon_speed']); faster.get('a')!.buffStacks = { napoleon_speed: 1 };
    faster.get('b')!.characterId = 'pikachu'; faster.get('b')!.resources.charge = 1;
    resolveRound(faster, actions(['a', { actionId: 'hollow_fist', targetId: 'b' }], ['b', { actionId: 'quick_attack', targetGridIndex: 3 }], ['c', { actionId: 'defend' }]));
    expect(faster.get('b')!.alive).toBe(false);

    const locked = roster(['a', 0], ['b', 0], ['c', 0]);
    locked.get('a')!.gridIndex = 0; locked.get('b')!.gridIndex = 2; locked.get('c')!.gridIndex = 4;
    locked.get('b')!.characterId = 'pikachu'; locked.get('b')!.resources.charge = 1;
    resolveRound(locked, actions(['a', { actionId: 'nightmare_dash', targetId: 'b' }], ['b', { actionId: 'quick_attack', targetGridIndex: 3 }], ['c', { actionId: 'defend' }]));
    expect(locked.get('b')!.alive).toBe(false);
  });

  it('grants Cut globally when Ao transforms and upgrades mastery only after stealing resources', () => {
    const players = roster(['a', 0], ['b', 0]);
    resolveRound(players, actions(['a', { actionId: 'transform', transformCharacterId: 'ao' }], ['b', { actionId: 'defend' }]));
    expect(Array.from(players.values()).every((player) => player.buffs?.has('cut_granted'))).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')!.buffStacks?.ao_mastery).toBeUndefined();
    resolveRound(players, actions(['a', { actionId: 'gain_charge' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')!.buffStacks?.ao_mastery).toBeUndefined();
    resolveRound(players, actions(['a', { actionId: 'steal', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(players.get('a')!.buffStacks?.ao_mastery).toBeUndefined();
    resolveRound(players, actions(['a', { actionId: 'steal', targetId: 'b' }], ['b', { actionId: 'charge' }]));
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

  it('lets Dark Shelter absorb the damage added to a mastered Absorb', () => {
    const players = roster(['a', 0], ['b', 0]);
    const ao = players.get('a')!; ao.characterId = 'ao'; ao.buffs = new Set(['ao_mastery']); ao.buffStacks = { ao_mastery: 4 };
    const nightmare = players.get('b')!; nightmare.characterId = 'nightmare'; nightmare.currentHp = nightmare.maxHp = 2; nightmare.resources.charge = 1;
    resolveRound(players, actions(
      ['a', { actionId: 'absorb_charge', targetId: 'b' }],
      ['b', { actionId: 'dark_shelter' }],
    ));
    expect(nightmare.currentHp).toBe(2);
    expect(nightmare.buffs?.has('dark_shelter_power')).toBe(true);
  });

  it('reduces Shadow Blade cooldown only after Nightmare-specific actions', () => {
    const players = roster(['a', 10], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'nightmare'; actor.buffs = new Set(['shadow_blade_cooldown']); actor.buffStacks = { shadow_blade_cooldown: 4 };
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffStacks?.shadow_blade_cooldown).toBe(4);
    for (const remaining of [3, 2, 1]) {
      resolveRound(players, actions(['a', { actionId: 'dream_path', targetId: 'b', targetGridIndex: 0, pathDirection: 1 }], ['b', { actionId: 'defend' }]));
      expect(actor.buffStacks?.shadow_blade_cooldown).toBe(remaining);
    }
    resolveRound(players, actions(['a', { actionId: 'dream_path', targetId: 'b', targetGridIndex: 0, pathDirection: 1 }], ['b', { actionId: 'defend' }]));
    expect(actor.buffs?.has('shadow_blade_cooldown')).toBe(false);
  });

  it('lays Dream Path in either direction, damages every player on it, and moves onto an occupied path cell', () => {
    const players = roster(['a', 3], ['b', 0], ['c', 0]);
    const nightmare = players.get('a')!; nightmare.characterId = 'nightmare'; nightmare.currentHp = nightmare.maxHp = 2; nightmare.gridIndex = 0;
    const target = players.get('b')!; target.currentHp = target.maxHp = 2; target.gridIndex = 2;
    const middle = players.get('c')!; middle.currentHp = middle.maxHp = 2; middle.gridIndex = 4;
    const boardObjects = new Map<string, CombatBoardObject>();

    resolveRound(players, actions(
      ['a', { actionId: 'dream_path', targetId: 'b', targetGridIndex: 4, pathDirection: -1 }],
      ['b', { actionId: 'charge' }],
      ['c', { actionId: 'charge' }],
    ), boardObjects);

    expect(target.currentHp).toBe(1);
    expect(middle.currentHp).toBe(1);
    expect(nightmare.gridIndex).toBe(4);
    expect(Array.from(boardObjects.values()).map((object) => object.gridIndex).sort()).toEqual([0, 2, 3, 4, 5]);
    expect(Array.from(boardObjects.values()).every((object) => object.definitionId === 'dream_path' && object.remainingTurns === 3)).toBe(true);
  });

  it('refreshes overlapping Dream Path terrain and grants its attack bonus to every Nightmare', () => {
    const players = roster(['a', 2], ['b', 0]); const nightmare = players.get('a')!; const target = players.get('b')!;
    nightmare.characterId = 'nightmare'; nightmare.currentHp = nightmare.maxHp = 2; nightmare.gridIndex = 0;
    target.currentHp = target.maxHp = 2; target.gridIndex = 2;
    const path: CombatBoardObject = { objectId: 'dream_path:0', definitionId: 'dream_path', kind: 'terrain', ownerPlayerId: 'other-nightmare', sourceCharacterId: 'nightmare', gridIndex: 0, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 1, permanent: false };
    const boardObjects = new Map([[path.objectId, path]]);

    target.resources.energy = 1;
    resolveRound(players, actions(['a', { actionId: 'wave', targetId: 'b' }], ['b', { actionId: 'wave', targetId: 'a' }]), boardObjects);
    expect(target.currentHp).toBe(1);

    nightmare.resources.energy = 2;
    resolveRound(players, actions(['a', { actionId: 'dream_path', targetId: 'b', targetGridIndex: 0, pathDirection: 1 }], ['b', { actionId: 'defend' }]), boardObjects);
    expect(boardObjects.get('dream_path:0')?.remainingTurns).toBe(3);
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

  it('uses a command to trigger and consume the longest matching Napoleon strategy', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!; const target = players.get('b')!;
    actor.characterId = 'napoleon'; actor.commandBuffer = 'A'; actor.currentHp = actor.maxHp = 2; target.currentHp = target.maxHp = 2;
    const strategy = { actionId: 'nap_strategy_aa', targetId: 'b', napoleonStrategySource: 'command' as const, napoleonCommand: 'A' as const };
    expect(() => validateAction(actor, strategy, players)).not.toThrow();
    expect(() => validateAction(actor, { actionId: 'attack_order', targetId: 'b' }, players)).not.toThrow();
    resolveRound(players, actions(['a', strategy], ['b', { actionId: 'charge' }]));
    expect(actor.commandBuffer).toBe('');
    expect(target.currentHp).toBe(1);
  });

  it('applies a composite Napoleon strategy defense against unrelated attackers', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 1]); const actor = players.get('a')!;
    actor.characterId = 'napoleon'; actor.commandBuffer = 'AD'; actor.currentHp = actor.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'nap_strategy_ad', targetId: 'b', napoleonStrategySource: 'buffer' }],
      ['b', { actionId: 'charge' }],
      ['c', { actionId: 'slash', targetId: 'a' }],
    ));
    expect(actor.currentHp).toBe(2);
    expect(actor.commandBuffer).toBe('');
  });

  it('automatically counters the highest fully blocked attacker with DA', () => {
    const players = roster(['a', 0], ['b', 1]); const actor = players.get('a')!; const attacker = players.get('b')!;
    actor.characterId = 'napoleon'; actor.commandBuffer = 'DA'; actor.currentHp = actor.maxHp = 2; attacker.currentHp = attacker.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'nap_strategy_da', napoleonStrategySource: 'buffer' }],
      ['b', { actionId: 'fist', targetId: 'a' }],
    ));
    expect(actor.currentHp).toBe(2);
    expect(attacker.currentHp).toBe(0);
    expect(attacker.alive).toBe(false);
  });

  it('unlocks Napoleon transformation only through Elba Escape', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'napoleon'; actor.commandBuffer = 'TATAT'; actor.currentHp = actor.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'nap_strategy_tatat', napoleonStrategySource: 'buffer' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffs?.has('elba_unlocked')).toBe(true);
    expect(actor.buffs?.has('hundred_days')).toBe(true);
  });

  it('grants tactical advantage only when a Napoleon strategy or engine resolves', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'napoleon'; actor.commandBuffer = 'TT'; actor.currentHp = actor.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'nap_strategy_tt', napoleonStrategySource: 'buffer' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffStacks?.tactical_advantage).toBe(2);
    expect(actor.buffRemainingTurns?.tactical_advantage).toBe(3);
    expect(actor.commandBuffer).toBe('');
  });

  it.each([
    ['AT', 'nap_strategy_at', 1, 3],
    ['DT', 'nap_strategy_dt', 1, 3],
    ['TT', 'nap_strategy_tt', 2, 3],
    ['TTT', 'nap_strategy_ttt', 3, 3],
    ['TTTT', 'nap_strategy_tttt', 4, 4],
    ['TTTTT', 'nap_strategy_ttttt', 5, 5],
  ] as const)('gives %s strategy tactical advantage its shortened duration', (sequence, actionId, stacks, storedTurnsBeforeRoomTick) => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'napoleon'; actor.commandBuffer = sequence; actor.currentHp = actor.maxHp = 2;

    resolveRound(players, actions(
      ['a', { actionId, targetId: sequence === 'AT' ? 'b' : undefined, napoleonStrategySource: 'buffer' }],
      ['b', { actionId: 'defend' }],
    ));

    expect(actor.buffStacks?.tactical_advantage).toBe(stacks);
    expect(actor.buffRemainingTurns?.tactical_advantage).toBe(storedTurnsBeforeRoomTick);
  });

  it('keeps the longest duration when multiple Napoleon engines grant tactical advantage', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'napoleon'; actor.currentHp = actor.maxHp = 2;
    actor.buffs = new Set(['napoleon_emperor', 'hundred_days', 'unfallen_fortress']);
    actor.buffStacks = { napoleon_emperor: 1, hundred_days: 1, unfallen_fortress: 1 };
    actor.buffRemainingTurns = { napoleon_emperor: 5, hundred_days: 0, unfallen_fortress: 3 };

    resolveRound(players, actions(['a', { actionId: 'tactical_order' }], ['b', { actionId: 'defend' }]));

    expect(actor.buffStacks.tactical_advantage).toBe(4);
    expect(actor.buffRemainingTurns.tactical_advantage).toBe(6);
  });

  it('does not grant basic resources to Napoleon when damaged', () => {
    const players = roster(['a', 0], ['b', 1]); const actor = players.get('a')!;
    actor.characterId = 'napoleon'; actor.currentHp = actor.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'tactical_order' }], ['b', { actionId: 'slash', targetId: 'a' }]));
    expect(actor.currentHp).toBe(1);
    expect(actor.resources.energy).toBe(0);
  });

  it('lets Ye Qingxian sacrifice one health state for an exact one-resource shortfall', () => {
    const players = roster(['a', 2], ['b', 0]); const actor = players.get('a')!; const target = players.get('b')!;
    actor.characterId = 'ye_qingxian'; actor.resources.charge = 1; actor.currentHp = actor.maxHp = 2; target.currentHp = target.maxHp = 2;
    actor.buffs = new Set(['sacrifice_path_progress']); actor.buffStacks = { sacrifice_path_progress: 3 };
    const palm = { actionId: 'immortal_palm', targetId: 'b', resourceChoice: 'charge' as const };
    expect(() => validateAction(actor, palm, players)).not.toThrow();
    resolveRound(players, actions(['a', palm], ['b', { actionId: 'charge' }]));
    expect(actor.currentHp).toBe(1);
    expect(actor.resources.energy).toBe(1);
    expect(actor.resources.charge).toBe(2);
    expect(target.alive).toBe(false);
    expect(actor.buffStacks.sacrifice_path_progress).toBe(5);
  });

  it('tracks Sacrifice Path from cumulative gains without losing activation after spending', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'ye_qingxian'; actor.currentHp = actor.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'charge', resourceChoice: 'energy' }], ['b', { actionId: 'defend' }]));
    resolveRound(players, actions(['a', { actionId: 'gain_charge', resourceChoice: 'energy' }], ['b', { actionId: 'defend' }]));
    resolveRound(players, actions(['a', { actionId: 'charge', resourceChoice: 'energy' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffStacks?.sacrifice_path_progress).toBe(3);
    expect(actor.buffs?.has('sacrifice_path_active')).toBe(true);
    actor.resources.energy = 2; actor.resources.charge = 0;
    expect(() => validateAction(actor, { actionId: 'immortal_palm', targetId: 'b', resourceChoice: 'energy' }, players)).not.toThrow();
  });

  it('grants near-death Energy again after Ye Qingxian recovers and sacrifices again', () => {
    const players = roster(['a', 2], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'ye_qingxian'; actor.currentHp = actor.maxHp = 2;
    actor.buffs = new Set(['sacrifice_path_progress']); actor.buffStacks = { sacrifice_path_progress: 3 };
    const palm = { actionId: 'immortal_palm', targetId: 'b', resourceChoice: 'energy' as const };
    resolveRound(players, actions(['a', palm], ['b', { actionId: 'super_defend' }]));
    expect(actor.currentHp).toBe(1); expect(actor.resources.energy).toBe(1);
    resolveRound(players, actions(['a', { actionId: 'charge', resourceChoice: 'energy' }], ['b', { actionId: 'defend' }]));
    resolveRound(players, actions(['a', { actionId: 'heal', resourceChoice: 'energy' }], ['b', { actionId: 'defend' }]));
    expect(actor.currentHp).toBe(2); expect(actor.resources.energy).toBe(2);
    resolveRound(players, actions(['a', palm], ['b', { actionId: 'super_defend' }]));
    expect(actor.currentHp).toBe(1); expect(actor.resources.energy).toBe(1);
  });

  it('records a Devour learning opportunity after a direct elimination', () => {
    const players = roster(['a', 3], ['b', 0]); const actor = players.get('a')!; const target = players.get('b')!;
    actor.characterId = 'ye_qingxian'; actor.currentHp = actor.maxHp = 2; target.characterId = 'warrior'; target.currentHp = target.maxHp = 2;
    const result = resolveRound(players, actions(['a', { actionId: 'immortal_palm', targetId: 'b', resourceChoice: 'energy' }], ['b', { actionId: 'charge' }]));
    expect(result.learningTargets).toEqual([{ learnerPlayerId: 'a', targetPlayerId: 'b' }]);
  });

  it('applies Star Body before block and lets true damage bypass only Star Body', () => {
    const players = roster(['a', 0], ['b', 0]); const attacker = players.get('a')!; const target = players.get('b')!;
    target.characterId = 'star_god'; target.currentHp = target.maxHp = 2; target.buffs = new Set(['star_body']); target.buffStacks = { star_body: 1.5 };
    resolveRound(players, actions(['a', { actionId: 'wave', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.currentHp).toBe(2);
    target.buffs.add('mud_barrier'); target.buffStacks.mud_barrier = 1;
    attacker.characterId = 'ku'; attacker.resources.charge = 2; attacker.buffs = new Set(['tempered']); attacker.buffStacks = { tempered: 1 };
    resolveRound(players, actions(['a', { actionId: 'void_pierce', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.currentHp).toBe(2);
    expect(target.buffs?.has('mud_barrier')).toBe(false);
  });

  it('consumes an eligible barrier before Star Body or other numeric defenses', () => {
    const players = roster(['a', 0], ['b', 0]); const target = players.get('b')!;
    target.characterId = 'mudrock'; target.currentHp = target.maxHp = 2;
    target.buffs = new Set(['mud_barrier', 'star_body', 'armor']);
    target.buffStacks = { mud_barrier: 1, star_body: 2, armor: 2 };
    resolveRound(players, actions(['a', { actionId: 'wave', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.buffs?.has('mud_barrier')).toBe(false);
    expect(target.buffStacks?.star_body).toBe(2);
    expect(target.buffStacks?.armor).toBe(2);
  });

  it('lets ordinary block reduce true damage', () => {
    const players = roster(['a', 0], ['b', 0]); const attacker = players.get('a')!; const target = players.get('b')!;
    attacker.characterId = 'ku'; attacker.resources.charge = 2;
    attacker.buffs = new Set(['tempered']); attacker.buffStacks = { tempered: 1.5 };
    target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'void_pierce', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(target.currentHp).toBe(2);
  });

  it('kills when a level-3 damage source retains at least 1 effective damage after block', () => {
    const players = roster(['a', 0], ['b', 0]); const target = players.get('b')!;
    players.get('a')!.resources.charge = 1; target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'atomic_breath', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(target.currentHp).toBe(0);
    expect(target.alive).toBe(false);
  });

  it('lets Devour trigger when a base action shifts another player', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!; const target = players.get('b')!;
    actor.characterId = 'ye_qingxian'; actor.currentHp = actor.maxHp = 2; actor.resources.charge = 1;
    target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'slash', targetId: 'b', resourceChoice: 'energy' }], ['b', { actionId: 'charge' }]));
    expect(target.currentHp).toBe(1);
    expect(actor.resources.energy).toBe(1);
  });

  it('preserves near-death state across repeated transformations', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'ye_qingxian'; actor.currentHp = 1; actor.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'transform', transformCharacterId: 'star_god' }], ['b', { actionId: 'charge' }]));
    expect(actor.currentHp).toBe(1);
    expect(actor.maxHp).toBe(2);
    resolveRound(players, actions(['a', { actionId: 'transform', transformCharacterId: 'ye_qingxian' }], ['b', { actionId: 'charge' }]));
    expect(actor.currentHp).toBe(1);
    expect(actor.maxHp).toBe(2);
  });

  it('does not trigger the device lock when a near-death player transforms into Inner Guard', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'ye_qingxian'; actor.currentHp = 1; actor.maxHp = 2;
    resolveRound(players, actions(
      ['a', { actionId: 'transform', transformCharacterId: 'inner_guard' }],
      ['b', { actionId: 'fist', targetId: 'a' }],
    ));
    expect(actor.characterId).toBe('inner_guard');
    expect(actor.currentHp).toBe(0);
    expect(actor.alive).toBe(false);
    expect(actor.buffs?.has('unbroken')).toBe(false);
  });

  it('never accepts the initial character as a transformation target', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'ye_qingxian'; actor.currentHp = actor.maxHp = 2;
    expect(() => validateAction(actor, { actionId: 'transform', transformCharacterId: 'default_character' }, players)).toThrow(/有效的变身角色/);
  });

  it('centers Rule the World on its selected grid cell', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0], ['d', 0]); const actor = players.get('a')!;
    actor.characterId = 'ye_qingxian'; actor.currentHp = actor.maxHp = 2; actor.gridIndex = 0;
    actor.resources.energy = 1; actor.resources.charge = 2;
    players.get('b')!.gridIndex = 2; players.get('c')!.gridIndex = 4; players.get('d')!.gridIndex = 6;
    for (const target of players.values()) { target.currentHp = 2; target.maxHp = 2; }
    players.get('c')!.resources.charge = 1;
    const action = { actionId: 'rule_the_world', targetGridIndex: 6, resourceChoice: 'energy' as const };
    expect(() => validateAction(actor, action, players)).not.toThrow();
    resolveRound(players, actions(['a', action], ['b', { actionId: 'charge' }], ['c', { actionId: 'atomic_breath', targetId: 'a' }], ['d', { actionId: 'charge' }]));
    expect(players.get('b')!.alive).toBe(true);
    expect(players.get('c')!.alive).toBe(true);
    expect(players.get('d')!.alive).toBe(true);
    expect(players.get('c')!.currentHp).toBe(2);
    expect(players.get('d')!.currentHp).toBe(2);
    expect(players.get('c')!.buffs?.has('fear')).toBe(true);
    expect(players.get('d')!.buffs?.has('fear')).toBe(true);
  });

  it('applies Star Body after damage opposition rather than before it', () => {
    const players = roster(['a', 0], ['b', 0]); const target = players.get('b')!;
    players.get('a')!.resources.charge = 1; target.currentHp = target.maxHp = 2;
    target.characterId = 'star_god'; target.buffs = new Set(['star_body']); target.buffStacks = { star_body: 1 };
    resolveRound(players, actions(
      ['a', { actionId: 'atomic_breath', targetId: 'b' }],
      ['b', { actionId: 'slash', targetId: 'a' }],
    ));
    expect(target.currentHp).toBe(1);
    expect(target.alive).toBe(true);
  });

  it('retrospectively kills on a heavy hit even after a higher nonlethal hit resolved', () => {
    const fastTrue = structuredClone(actionById.get('wave')!) as ActionDefinition;
    fastTrue.id = 'test_fast_true'; fastTrue.name = '测试快速真实伤害'; fastTrue.level = 1.5; fastTrue.speedPriority = 3; fastTrue.damageType = 'true';
    actionById.set(fastTrue.id, fastTrue);
    try {
      const players = roster(['a', 0], ['b', 0], ['c', 2]); const target = players.get('b')!;
      players.get('c')!.resources.charge = 1; target.currentHp = target.maxHp = 2;
      target.characterId = 'star_god'; target.buffs = new Set(['star_body']); target.buffStacks = { star_body: 2 };
      resolveRound(players, actions(
        ['a', { actionId: fastTrue.id, targetId: 'b' }],
        ['b', { actionId: 'charge' }],
        ['c', { actionId: 'atomic_breath', targetId: 'b' }],
      ));
      expect(target.currentHp).toBe(0);
      expect(target.alive).toBe(false);
    } finally {
      actionById.delete(fastTrue.id);
    }
  });

  it('lets piercing damage ignore block but still apply Star Body and barrier', () => {
    const template = actionById.get('atomic_breath')!;
    const piercing = structuredClone(template) as ActionDefinition;
    piercing.id = 'test_piercing'; piercing.name = '测试穿刺'; piercing.damageType = 'piercing'; piercing.effects = [{ handler: 'wave' }];
    actionById.set(piercing.id, piercing);
    try {
      const players = roster(['a', 0], ['b', 0]); const target = players.get('b')!;
      target.characterId = 'star_god'; target.currentHp = target.maxHp = 2;
      target.buffs = new Set(['star_body', 'mud_barrier', 'armor']); target.buffStacks = { star_body: 1, mud_barrier: 1, armor: 2 };
      resolveRound(players, actions(['a', { actionId: piercing.id, targetId: 'b' }], ['b', { actionId: 'charge' }]));
      expect(target.currentHp).toBe(2);
      expect(target.buffs?.has('mud_barrier')).toBe(false);
      expect(target.buffStacks?.armor).toBe(2);
    } finally {
      actionById.delete(piercing.id);
    }
  });

  it('lets piercing damage bypass both block and armor', () => {
    const template = actionById.get('wave')!;
    const piercing = structuredClone(template) as ActionDefinition;
    piercing.id = 'test_piercing_block'; piercing.name = '测试穿刺格挡'; piercing.level = 1.5; piercing.damageType = 'piercing';
    actionById.set(piercing.id, piercing);
    try {
      const players = roster(['a', 0], ['b', 0]); const target = players.get('b')!;
      target.currentHp = target.maxHp = 2; target.buffs = new Set(['armor']); target.buffStacks = { armor: 2 };
      resolveRound(players, actions(['a', { actionId: piercing.id, targetId: 'b' }], ['b', { actionId: 'defend' }]));
      expect(target.currentHp).toBe(1);
      expect(target.buffStacks?.armor).toBe(2);
    } finally {
      actionById.delete(piercing.id);
    }
  });

  it('does not trigger Mudrock barrier while Mudrock uses a defense action', () => {
    const players = roster(['a', 0], ['b', 0]); const target = players.get('b')!;
    players.get('a')!.resources.charge = 1; target.characterId = 'mudrock'; target.currentHp = target.maxHp = 2;
    target.buffs = new Set(['mud_barrier']); target.buffStacks = { mud_barrier: 1 };
    resolveRound(players, actions(['a', { actionId: 'atomic_breath', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(target.alive).toBe(false);
    expect(target.buffs?.has('mud_barrier')).toBe(true);
  });

  it('grows Ku after a successful general defense', () => {
    const players = roster(['a', 1], ['b', 0]); const target = players.get('b')!;
    target.characterId = 'ku'; target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'wave', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    expect(target.buffStacks?.tempered).toBe(1);
    expect(target.resources.energy).toBe(0.5);
  });

  it('keeps the special-category Transcendence action as a level-3 temporary block', () => {
    const players = roster(['a', 2], ['b', 2]); const target = players.get('b')!;
    players.get('a')!.resources.charge = 1;
    target.characterId = 'star_god'; target.currentHp = target.maxHp = 2; target.resources.charge = 2;
    resolveRound(players, actions(['a', { actionId: 'atomic_breath', targetId: 'b' }], ['b', { actionId: 'create_star_core' }]));
    expect(target.alive).toBe(true);
    expect(target.currentHp).toBe(2);
    expect(target.buffs?.has('transcendence')).toBe(true);
  });

  it('consumes Star God transcendence instead of dying', () => {
    const players = roster(['a', 2], ['b', 0]); const target = players.get('b')!;
    players.get('a')!.resources.charge = 1; target.characterId = 'star_god'; target.currentHp = target.maxHp = 2; target.buffs = new Set(['transcendence']); target.buffStacks = { transcendence: 1 };
    resolveRound(players, actions(['a', { actionId: 'atomic_breath', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.alive).toBe(true);
    expect(target.currentHp).toBe(1);
    expect(target.buffs?.has('transcendence')).toBe(false);
  });

  it('does not let temporary transcendence save a near-death Star God', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 2]);
    const target = players.get('b')!;
    target.characterId = 'star_god'; target.currentHp = 1; target.maxHp = 2;
    target.buffs = new Set(['transcendence']); target.buffStacks = { transcendence: 1, transcendence_progress: 0 };
    resolveRound(players, actions(
      ['a', { actionId: 'fist', targetId: 'b' }],
      ['b', { actionId: 'charge' }],
      ['c', { actionId: 'atomic_breath', targetId: 'b' }],
    ));
    expect(target.alive).toBe(false);
    expect(target.currentHp).toBe(0);
    expect(target.buffs?.has('transcendence')).toBe(false);
  });

  it('heals one health state at the end of each transcendence round', () => {
    const players = roster(['a', 0], ['b', 0]); const target = players.get('b')!;
    target.characterId = 'star_god'; target.currentHp = 1; target.maxHp = 2;
    target.buffs = new Set(['transcendence']); target.buffStacks = { transcendence: 1, transcendence_progress: 0 };
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'charge' }]));
    expect(target.currentHp).toBe(2);
    expect(target.buffStacks?.star_body).toBe(0.5);
    expect(target.buffStacks?.transcendence_progress).toBe(1);
  });

  it('locks Inner Guard at one device and keeps Dominion as unique terrain markers', () => {
    const players = roster(['a', 2], ['b', 0]); const target = players.get('b')!;
    players.get('a')!.resources.charge = 1; players.get('a')!.gridIndex = 0;
    target.characterId = 'inner_guard'; target.currentHp = target.maxHp = 3; target.gridIndex = 2;
    const existing = dominion('b', 0);
    const boardObjects = new Map<string, CombatBoardObject>([[existing.objectId, existing]]);
    resolveRound(players, actions(['a', { actionId: 'atomic_breath', targetId: 'b' }], ['b', { actionId: 'charge' }]), boardObjects);
    expect(target.currentHp).toBe(1);
    expect(target.alive).toBe(true);
    expect(target.buffs?.has('unbroken')).toBe(true);
    expect(target.buffStacks?.inner_guard_devices).toBe(1);
    expect(boardObjects.get(existing.objectId)).toBe(existing);
    expect(Array.from(boardObjects.values()).map((object) => [object.gridIndex, object.stacks])).toEqual([[0, 1], [1, 1], [3, 1]]);
  });

  it('makes an original level-3 source remove two Inner Guard devices when at least 1 damage remains', () => {
    const players = roster(['a', 2], ['b', 1]); const target = players.get('b')!;
    players.get('a')!.resources.charge = 1; target.characterId = 'inner_guard'; target.currentHp = target.maxHp = 3;
    resolveRound(players, actions(
      ['a', { actionId: 'atomic_breath', targetId: 'b' }],
      ['b', { actionId: 'slash', targetId: 'a' }],
    ));
    expect(target.currentHp).toBe(1);
    expect(target.buffs?.has('unbroken')).toBe(true);
  });

  it('makes an original level-3 source remove only one Inner Guard device when 0.5 damage remains', () => {
    const players = roster(['a', 2], ['b', 0]); const target = players.get('b')!;
    players.get('a')!.resources.charge = 1;
    target.characterId = 'inner_guard'; target.currentHp = target.maxHp = 3;
    target.buffs = new Set(['star_body']); target.buffStacks = { star_body: 0.5 };
    resolveRound(players, actions(
      ['a', { actionId: 'atomic_breath', targetId: 'b' }],
      ['b', { actionId: 'defend' }],
    ));
    expect(target.currentHp).toBe(2);
    expect(target.buffs?.has('unbroken')).toBe(false);
  });

  it('lets fragile Inner Guard trigger the one-device lock instead of dying', () => {
    const players = roster(['a', 2], ['b', 1]); const target = players.get('b')!;
    players.get('a')!.resources.charge = 1; target.characterId = 'inner_guard'; target.currentHp = target.maxHp = 3;
    resolveRound(players, actions(['a', { actionId: 'atomic_breath', targetId: 'b' }], ['b', { actionId: 'fist', targetId: 'a' }]));
    expect(target.currentHp).toBe(1);
    expect(target.alive).toBe(true);
    expect(target.buffs?.has('unbroken')).toBe(true);
  });

  it('applies direct health shifts to devices and runs the same lock check', () => {
    const players = roster(['a', 0], ['b', 0]); const target = players.get('b')!;
    players.get('a')!.gridIndex = 0; target.characterId = 'inner_guard'; target.currentHp = 2; target.maxHp = 3; target.gridIndex = 2;
    const boardObjects = new Map<string, CombatBoardObject>();
    resolveRound(players, actions(['a', { actionId: 'chop' }], ['b', { actionId: 'steal', targetId: 'a' }]), boardObjects);
    expect(target.currentHp).toBe(1);
    expect(target.buffs?.has('unbroken')).toBe(true);
    expect(Array.from(boardObjects.values()).map((object) => object.gridIndex)).toEqual([0, 1, 3]);
  });

  it('makes Dissipation skip effect and damage opposition and attribute its Dominion source to the target cell', () => {
    const players = roster(['a', 0], ['b', 2]); const target = players.get('b')!;
    players.get('a')!.resources.charge = 1; players.get('a')!.characterId = 'inner_guard'; players.get('a')!.gridIndex = 0;
    target.characterId = 'inner_guard'; target.currentHp = target.maxHp = 3; target.gridIndex = 2; target.resources.charge = 1;
    const boardObjects = new Map<string, CombatBoardObject>();
    resolveRound(players, actions(['a', { actionId: 'dissipation', targetId: 'b' }], ['b', { actionId: 'atomic_breath', targetId: 'a' }]), boardObjects);
    expect(target.currentHp).toBe(2);
    expect(Array.from(boardObjects.values()).filter((object) => object.ownerPlayerId === 'b').map((object) => object.gridIndex)).toEqual([2, 3, 1]);
  });

  it('uses Dominion cells for Collapsing Fear and reduces its near-death cost', () => {
    const players = roster(['a', 2], ['b', 0], ['c', 0]); const actor = players.get('a')!;
    actor.characterId = 'inner_guard'; actor.currentHp = 1; actor.maxHp = 3; actor.gridIndex = 0;
    players.get('b')!.currentHp = players.get('b')!.maxHp = 2; players.get('b')!.gridIndex = 2;
    players.get('c')!.currentHp = players.get('c')!.maxHp = 2; players.get('c')!.gridIndex = 4;
    const actorDominion = dominion('a', 0); const targetDominion = dominion('a', 4);
    const boardObjects = new Map<string, CombatBoardObject>([[actorDominion.objectId, actorDominion], [targetDominion.objectId, targetDominion]]);
    expect(() => validateAction(actor, { actionId: 'collapsing_fear' }, players)).not.toThrow();
    resolveRound(players, actions(['a', { actionId: 'collapsing_fear' }], ['b', { actionId: 'charge' }], ['c', { actionId: 'charge' }]), boardObjects);
    expect(actor.resources.energy).toBe(0);
    expect(actor.alive).toBe(true);
    expect(actor.currentHp).toBe(1);
    expect(players.get('b')!.alive).toBe(false);
    expect(players.get('c')!.alive).toBe(false);
  });

  it('resolves a player covered by both Collapsing Fear target sets only once at the higher level', () => {
    const players = roster(['a', 2], ['b', 0]); const actor = players.get('a')!; const target = players.get('b')!;
    actor.characterId = 'inner_guard'; actor.currentHp = 1; actor.maxHp = 3; actor.gridIndex = 0;
    target.characterId = 'quilon'; target.currentHp = target.maxHp = 2; target.gridIndex = 2;
    const targetDominion = dominion('a', 2); const boardObjects = new Map([[targetDominion.objectId, targetDominion]]);
    const result = resolveRound(players, actions(['a', { actionId: 'collapsing_fear' }], ['b', { actionId: 'charge' }]), boardObjects);
    expect(result.summary.filter((line) => line.includes('坍缩恐惧（效果') && line.includes('对 B'))).toHaveLength(1);
    expect(result.summary.some((line) => line.includes('效果 4 / 伤害 4'))).toBe(true);
    expect(target.alive).toBe(true);
    expect(target.currentHp).toBe(2);
    expect(target.buffs?.has('wuyou_used')).toBe(true);
    expect(result.eliminated).not.toContain('b');
  });

  it('targets the first player in each direction even when neither stands on Dominion', () => {
    const players = roster(['a', 3], ['b', 0], ['c', 0]); const actor = players.get('a')!;
    actor.characterId = 'inner_guard'; actor.currentHp = 2; actor.maxHp = 3; actor.gridIndex = 0;
    players.get('b')!.currentHp = players.get('b')!.maxHp = 2; players.get('b')!.gridIndex = 2;
    players.get('c')!.currentHp = players.get('c')!.maxHp = 2; players.get('c')!.gridIndex = 4;
    resolveRound(players, actions(['a', { actionId: 'collapsing_fear' }], ['b', { actionId: 'charge' }], ['c', { actionId: 'charge' }]));
    expect(players.get('b')!.currentHp).toBe(1);
    expect(players.get('c')!.currentHp).toBe(1);
  });

  it('never targets the Inner Guard itself with Collapsing Fear in a two-player game', () => {
    const players = roster(['a', 2], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'inner_guard'; actor.currentHp = 1; actor.maxHp = 3; actor.gridIndex = 0;
    players.get('b')!.currentHp = players.get('b')!.maxHp = 2; players.get('b')!.gridIndex = 2;
    const actorDominion = dominion('a', 0); const targetDominion = dominion('a', 2);
    const boardObjects = new Map<string, CombatBoardObject>([[actorDominion.objectId, actorDominion], [targetDominion.objectId, targetDominion]]);
    resolveRound(players, actions(['a', { actionId: 'collapsing_fear' }], ['b', { actionId: 'charge' }]), boardObjects);
    expect(actor.alive).toBe(true);
    expect(actor.currentHp).toBe(1);
    expect(players.get('b')!.alive).toBe(false);
  });

  it('summons Nilu Fire and lets it protect Quilon from an incoming attack', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'quilon'; actor.currentHp = actor.maxHp = 2; actor.resources.charge = 1; actor.gridIndex = 0;
    players.get('b')!.gridIndex = 2;
    const boardObjects = new Map<string, CombatBoardObject>();
    expect(() => validateAction(actor, { actionId: 'breathing_method', targetGridIndex: 1 }, players, boardObjects)).not.toThrow();
    resolveRound(players, actions(['a', { actionId: 'breathing_method', targetGridIndex: 1 }], ['b', { actionId: 'charge' }]), boardObjects);
    expect(boardObjects.get('nilu_fire:a:1')).toMatchObject({ definitionId: 'nilu_fire', kind: 'terrain', gridIndex: 1, currentHp: 0 });
    expect(actor.buffs?.has('nilu_resistance')).toBe(true);
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'fist', targetId: 'a' }]), boardObjects);
    expect(actor.currentHp).toBe(2);
  });

  it('allows Breathing Method on any empty unit cell and rejects players or summons', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]); const actor = players.get('a')!;
    actor.characterId = 'quilon'; actor.resources.charge = 1; actor.gridIndex = 0;
    players.get('b')!.gridIndex = 2; players.get('c')!.gridIndex = 4;
    const lotus: CombatBoardObject = { objectId: 'lotus_seat:b', definitionId: 'lotus_seat', kind: 'summon', ownerPlayerId: 'b', sourceCharacterId: 'quilon', gridIndex: 1, stacks: 1, currentHp: 10, maxHp: 10, remainingTurns: 0, permanent: true };
    const boardObjects = new Map([[lotus.objectId, lotus]]);
    expect(() => validateAction(actor, { actionId: 'breathing_method', targetGridIndex: 3 }, players, boardObjects)).not.toThrow();
    expect(() => validateAction(actor, { actionId: 'breathing_method', targetGridIndex: 2 }, players, boardObjects)).toThrow(/没有单位/);
    expect(() => validateAction(actor, { actionId: 'breathing_method', targetGridIndex: 1 }, players, boardObjects)).toThrow(/没有单位/);
  });

  it('revives Quilon once and grants Bodhisattva Debate after lethal damage', () => {
    const players = roster(['a', 0], ['b', 2]); const actor = players.get('a')!;
    actor.characterId = 'quilon'; actor.currentHp = actor.maxHp = 2;
    players.get('b')!.resources.charge = 1;
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'atomic_breath', targetId: 'a' }]));
    expect(actor.alive).toBe(true);
    expect(actor.currentHp).toBe(2);
    expect(actor.buffs?.has('wuyou_used')).toBe(true);
    expect(actor.buffs?.has('bodhisattva_debate')).toBe(true);
  });

  it('revives Quilon only after every damaging action in the round has resolved', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]); const actor = players.get('a')!;
    actor.characterId = 'quilon'; actor.currentHp = actor.maxHp = 2; actor.gridIndex = 0;
    players.get('b')!.resources.charge = 1; players.get('b')!.gridIndex = 2;
    players.get('c')!.resources.charge = 1; players.get('c')!.gridIndex = 4;
    const result = resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'atomic_breath', targetId: 'a' }], ['c', { actionId: 'atomic_breath', targetId: 'a' }]));
    expect(result.summary.filter((line) => line.includes('触发无忧觉'))).toHaveLength(1);
    expect(actor.alive).toBe(true);
    expect(actor.currentHp).toBe(2);
    expect(actor.buffs?.has('bodhisattva_debate')).toBe(true);
    expect(result.eliminated).not.toContain('a');
  });

  it('tracks every Energy and Charge gain for Wuyou without reducing the counter when spent', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'quilon'; actor.currentHp = actor.maxHp = 2;
    for (let round = 0; round < 7; round += 1) resolveRound(players, actions(['a', { actionId: round % 2 === 0 ? 'charge' : 'gain_charge' }], ['b', { actionId: 'defend' }]));
    expect(actor.buffStacks?.wuyou_awareness).toBe(7);
    actor.resources.energy = 2;
    const boardObjects = new Map<string, CombatBoardObject>(); actor.gridIndex = 0; players.get('b')!.gridIndex = 2;
    resolveRound(players, actions(['a', { actionId: 'three_bodies', targetGridIndex: 1 }], ['b', { actionId: 'defend' }]), boardObjects);
    expect(actor.buffStacks?.wuyou_awareness).toBe(7);
  });

  it('uses Nilu Fire as binary resistance against external negative buffs', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'quilon'; actor.currentHp = actor.maxHp = 2; actor.gridIndex = 0;
    const fire: CombatBoardObject = { objectId: 'nilu_fire:a:1', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'a', sourceCharacterId: 'quilon', gridIndex: 1, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true };
    players.get('b')!.resources.charge = 1;
    resolveRound(players, actions(['a', { actionId: 'charge' }], ['b', { actionId: 'nebula_shock', targetId: 'a' }]), new Map([[fire.objectId, fire]]));
    expect(actor.buffs?.has('shock')).toBe(false);
  });

  it('makes a successful Five Precepts trigger Nilu Fire once for every hit', () => {
    const players = roster(['a', 3], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'quilon'; actor.currentHp = actor.maxHp = 2; actor.gridIndex = 0;
    players.get('b')!.currentHp = players.get('b')!.maxHp = 2; players.get('b')!.gridIndex = 2;
    const fire: CombatBoardObject = { objectId: 'nilu_fire:a:1', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'a', sourceCharacterId: 'quilon', gridIndex: 1, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true };
    const result = resolveRound(players, actions(['a', { actionId: 'five_precepts', targetId: 'b' }], ['b', { actionId: 'fist', targetId: 'a' }]), new Map([[fire.objectId, fire]]));
    expect(result.summary.filter((line) => line.includes('1 团尼卢火引燃了 1 次'))).toHaveLength(5);
  });

  it('attributes Nilu Fire to Quilon and lets the target oppose it as an attack against Quilon', () => {
    const players = roster(['q', 0], ['b', 0], ['c', 0]); const quilon = players.get('q')!; const target = players.get('b')!;
    quilon.characterId = 'quilon'; quilon.currentHp = quilon.maxHp = 2; quilon.gridIndex = 0;
    target.currentHp = target.maxHp = 2; target.gridIndex = 2; players.get('c')!.gridIndex = 4;
    const fire: CombatBoardObject = { objectId: 'nilu_fire:q:1', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'q', sourceCharacterId: 'quilon', gridIndex: 1, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true };
    resolveRound(players, actions(
      ['q', { actionId: 'fist', targetId: 'c' }],
      ['b', { actionId: 'slash', targetId: 'q' }],
      ['c', { actionId: 'charge' }],
    ), new Map([[fire.objectId, fire]]));
    expect(target.currentHp).toBe(2);
  });

  it('keeps Fire Purification off Quilon and resolves its true damage through block', () => {
    const players = roster(['q', 1], ['b', 0], ['c', 0]); const quilon = players.get('q')!;
    quilon.characterId = 'quilon'; quilon.currentHp = quilon.maxHp = 2; quilon.gridIndex = 0;
    players.get('b')!.currentHp = players.get('b')!.maxHp = 2; players.get('b')!.gridIndex = 2;
    players.get('c')!.currentHp = players.get('c')!.maxHp = 2; players.get('c')!.gridIndex = 3;
    const fire: CombatBoardObject = { objectId: 'nilu_fire:q:1', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'q', sourceCharacterId: 'quilon', gridIndex: 1, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true };
    resolveRound(players, actions(
      ['q', { actionId: 'fire_purification' }],
      ['b', { actionId: 'defend' }],
      ['c', { actionId: 'charge' }],
    ), new Map([[fire.objectId, fire]]));
    expect(quilon.currentHp).toBe(2);
    expect(players.get('b')!.currentHp).toBe(2);
    expect(players.get('c')!.currentHp).toBe(1);
  });

  it('stops Fire Purification with Super Defense or Unbroken', () => {
    for (const defense of ['super_defend', 'unbroken'] as const) {
      const players = roster(['q', 1], ['b', defense === 'super_defend' ? 1 : 0]); const quilon = players.get('q')!; const target = players.get('b')!;
      quilon.characterId = 'quilon'; quilon.currentHp = quilon.maxHp = 2; quilon.gridIndex = 0;
      target.currentHp = target.maxHp = 2; target.gridIndex = 2;
      if (defense === 'unbroken') target.buffs = new Set(['unbroken']);
      const fire: CombatBoardObject = { objectId: 'nilu_fire:q:1', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'q', sourceCharacterId: 'quilon', gridIndex: 1, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true };
      resolveRound(players, actions(['q', { actionId: 'fire_purification' }], ['b', { actionId: defense === 'super_defend' ? 'super_defend' : 'charge' }]), new Map([[fire.objectId, fire]]));
      expect(target.currentHp).toBe(2);
    }
  });

  it('makes Unbroken immune to direct damage outside attack resolution', () => {
    const players = roster(['a', 0], ['b', 0]); const target = players.get('a')!;
    target.currentHp = target.maxHp = 2; target.buffs = new Set(['unbroken', 'shock']);
    resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.currentHp).toBe(2);
  });

  it('moves the Lotus Seat once per round, absorbs ceil-halves, slows down, and delivers its cargo', () => {
    const players = roster(['a', 2], ['b', 3]); const actor = players.get('a')!; const target = players.get('b')!;
    actor.characterId = 'quilon'; actor.currentHp = actor.maxHp = 2; actor.gridIndex = 0; actor.buffs = new Set(['wuyou_awareness']); actor.buffStacks = { wuyou_awareness: 7 };
    target.resources.charge = 2; target.gridIndex = 1;
    const boardObjects = new Map<string, CombatBoardObject>();
    resolveRound(players, actions(['a', { actionId: 'three_bodies', targetGridIndex: 1 }], ['b', { actionId: 'defend' }]), boardObjects);
    const lotus = boardObjects.get('lotus_seat:a')!;
    expect(lotus).toMatchObject({ gridIndex: 0, originGridIndex: 0, movementDirection: 1, moveSpeed: 4, currentHp: 10 });
    resolveRound(players, actions(['a', { actionId: 'defend' }], ['b', { actionId: 'defend' }]), boardObjects);
    expect(lotus).toMatchObject({ gridIndex: 1, moveSpeed: 1, cargo: { b: { energy: 2, charge: 1 } } });
    expect(target.resources).toMatchObject({ energy: 1, charge: 1 });
    for (let round = 0; round < 3; round += 1) resolveRound(players, actions(['a', { actionId: 'defend' }], ['b', { actionId: 'defend' }]), boardObjects);
    expect(boardObjects.has(lotus.objectId)).toBe(false);
    expect(actor.resources).toMatchObject({ energy: 2, charge: 1 });
  });

  it('makes the Lotus Seat absorb every living player sharing its landing cell', () => {
    const players = roster(['q', 0], ['b', 3], ['c', 1]);
    players.get('q')!.characterId = 'quilon'; players.get('q')!.gridIndex = 0;
    players.get('b')!.resources.charge = 2; players.get('b')!.gridIndex = 1;
    players.get('c')!.resources.charge = 3; players.get('c')!.gridIndex = 1;
    const lotus: CombatBoardObject = { objectId: 'lotus_seat:q', definitionId: 'lotus_seat', kind: 'summon', ownerPlayerId: 'q', sourceCharacterId: 'quilon', gridIndex: 0, stacks: 1, currentHp: 10, maxHp: 10, remainingTurns: 0, permanent: true, originGridIndex: 0, movementDirection: 1, moveSpeed: 4, cargo: {} };
    resolveRound(players, actions(['q', { actionId: 'defend' }], ['b', { actionId: 'defend' }], ['c', { actionId: 'defend' }]), new Map([[lotus.objectId, lotus]]));
    expect(lotus.cargo).toEqual({ b: { energy: 2, charge: 1 }, c: { energy: 1, charge: 2 } });
    expect(players.get('b')!.resources).toMatchObject({ energy: 1, charge: 1 });
    expect(players.get('c')!.resources).toMatchObject({ energy: 0, charge: 1 });
  });

  it('caps action speed at four so the speed-four Lotus Seat still moves first', () => {
    const players = roster(['a', 0], ['b', 3], ['q', 0]); const attacker = players.get('a')!;
    attacker.characterId = 'napoleon'; attacker.resources.charge = 1; attacker.gridIndex = 2;
    attacker.buffs = new Set(['napoleon_speed']); attacker.buffStacks = { napoleon_speed: 5 };
    players.get('b')!.gridIndex = 1; players.get('q')!.gridIndex = 4;
    const lotus: CombatBoardObject = { objectId: 'lotus_seat:q', definitionId: 'lotus_seat', kind: 'summon', ownerPlayerId: 'q', sourceCharacterId: 'quilon', gridIndex: 0, stacks: 1, currentHp: 3, maxHp: 10, remainingTurns: 0, permanent: true, originGridIndex: 4, movementDirection: 1, moveSpeed: 4, cargo: {} };
    const result = resolveRound(players, actions(['a', { actionId: 'atomic_breath', targetBoardObjectId: lotus.objectId }], ['b', { actionId: 'defend' }], ['q', { actionId: 'defend' }]), new Map([[lotus.objectId, lotus]]));
    expect(result.summary.some((line) => line.includes('吸收'))).toBe(true);
    expect(players.get('b')!.resources.energy).toBe(3);
  });

  it('lets a single-target attack destroy the Lotus Seat and refunds cargo to its original player', () => {
    const players = roster(['a', 2], ['b', 0], ['q', 0]); players.get('a')!.resources.charge = 1;
    const lotus: CombatBoardObject = { objectId: 'lotus_seat:q', definitionId: 'lotus_seat', kind: 'summon', ownerPlayerId: 'q', sourceCharacterId: 'quilon', gridIndex: 0, stacks: 1, currentHp: 3, maxHp: 10, remainingTurns: 0, permanent: true, originGridIndex: 4, movementDirection: 1, moveSpeed: 0, cargo: { b: { energy: 2, charge: 1 } } };
    const boardObjects = new Map([[lotus.objectId, lotus]]);
    expect(() => validateAction(players.get('a')!, { actionId: 'atomic_breath', targetBoardObjectId: lotus.objectId }, players, boardObjects)).not.toThrow();
    resolveRound(players, actions(['a', { actionId: 'atomic_breath', targetBoardObjectId: lotus.objectId }], ['b', { actionId: 'defend' }], ['q', { actionId: 'defend' }]), boardObjects);
    expect(boardObjects.has(lotus.objectId)).toBe(false);
    expect(players.get('b')!.resources).toMatchObject({ energy: 2, charge: 1 });
  });

  it('extinguishes Nilu Fire with Heal without making the healer fragile', () => {
    const players = roster(['a', 0], ['b', 0], ['q', 0]);
    const healer = players.get('b')!;
    healer.characterId = 'quilon'; healer.currentHp = healer.maxHp = 2; healer.gridIndex = 2;
    healer.buffs = new Set(['wuyou_used']);
    players.get('a')!.gridIndex = 0; players.get('q')!.gridIndex = 4;
    const fire: CombatBoardObject = { objectId: 'nilu_fire:q:3', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'q', sourceCharacterId: 'quilon', gridIndex: 3, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true };
    const boardObjects = new Map([[fire.objectId, fire]]);
    resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'heal', targetGridIndex: 3 }], ['q', { actionId: 'defend' }]), boardObjects);
    expect(healer.alive).toBe(true);
    expect(healer.currentHp).toBe(1);
    expect(boardObjects.has(fire.objectId)).toBe(false);
  });

  it('adds overlapping Nilu Fire damage before applying the target fire mitigation', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0]);
    const actor = players.get('a')!; const target = players.get('b')!;
    actor.characterId = 'quilon'; actor.currentHp = actor.maxHp = 2; actor.gridIndex = 0;
    target.characterId = 'quilon'; target.currentHp = target.maxHp = 2; target.gridIndex = 2;
    players.get('c')!.gridIndex = 4;
    const fires: CombatBoardObject[] = [
      { objectId: 'nilu_fire:a:1', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'a', sourceCharacterId: 'quilon', gridIndex: 1, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true },
      { objectId: 'nilu_fire:a:3', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'a', sourceCharacterId: 'quilon', gridIndex: 3, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true },
      { objectId: 'nilu_fire:b:5', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'b', sourceCharacterId: 'quilon', gridIndex: 5, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true },
    ];
    resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'c' }], ['b', { actionId: 'charge' }], ['c', { actionId: 'charge' }]), new Map(fires.map((fire) => [fire.objectId, fire])));
    expect(target.currentHp).toBe(1);
  });

  it('makes Fist trigger Nilu Fire twice during Bodhisattva Debate', () => {
    const players = roster(['a', 0], ['b', 0]); const actor = players.get('a')!;
    actor.characterId = 'quilon'; actor.currentHp = actor.maxHp = 2; actor.gridIndex = 0;
    actor.buffs = new Set(['bodhisattva_debate']); players.get('b')!.gridIndex = 2;
    const fire: CombatBoardObject = { objectId: 'nilu_fire:a:1', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'a', sourceCharacterId: 'quilon', gridIndex: 1, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true };
    const result = resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'charge' }]), new Map([[fire.objectId, fire]]));
    expect(result.summary.some((line) => line.includes('2 次'))).toBe(true);
  });

  it('removes Quilon summons on final death and refunds Lotus cargo', () => {
    const players = roster(['a', 0], ['b', 0], ['q', 0]); const quilon = players.get('q')!;
    quilon.characterId = 'quilon'; quilon.currentHp = quilon.maxHp = 2; quilon.gridIndex = 4;
    quilon.buffs = new Set(['wuyou_used']); players.get('a')!.resources.charge = 1;
    const fire: CombatBoardObject = { objectId: 'nilu_fire:q:3', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'q', sourceCharacterId: 'quilon', gridIndex: 3, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true };
    const lotus: CombatBoardObject = { objectId: 'lotus_seat:q', definitionId: 'lotus_seat', kind: 'summon', ownerPlayerId: 'q', sourceCharacterId: 'quilon', gridIndex: 5, stacks: 1, currentHp: 10, maxHp: 10, remainingTurns: 0, permanent: true, originGridIndex: 4, movementDirection: 1, moveSpeed: 0, cargo: { b: { energy: 2, charge: 1 } } };
    const boardObjects = new Map([[fire.objectId, fire], [lotus.objectId, lotus]]);
    resolveRound(players, actions(['a', { actionId: 'atomic_breath', targetId: 'q' }], ['b', { actionId: 'defend' }], ['q', { actionId: 'charge' }]), boardObjects);
    expect(quilon.alive).toBe(false);
    expect(boardObjects.size).toBe(0);
    expect(players.get('b')!.resources).toMatchObject({ energy: 2, charge: 1 });
  });

  it('resolves Soul Reap without damage and applies Soul Reap plus Hellwalker for the next two rounds', () => {
    const players = roster(['a', 1], ['b', 0]); const chimei = players.get('a')!; const target = players.get('b')!;
    chimei.characterId = 'chimei'; chimei.currentHp = chimei.maxHp = 2; chimei.resources.soul = 0; chimei.gridIndex = 0;
    target.currentHp = target.maxHp = 2; target.gridIndex = 2;
    resolveRound(players, actions(['a', { actionId: 'soul_reap', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.currentHp).toBe(2);
    expect(chimei.resources.soul).toBe(1);
    expect(target.buffs).toEqual(expect.objectContaining(new Set(['soul_reap_debuff', 'hellwalker'])));
    expect(target.buffRemainingTurns).toMatchObject({ soul_reap_debuff: 3, hellwalker: 3 });
    expect(chimei.buffs?.has('hellwalker') ?? false).toBe(false);
  });

  it('applies targetless Hellwalker to only the two nearest other players without duplicates', () => {
    const players = roster(['a', 0], ['b', 0], ['c', 0], ['d', 0]); const chimei = players.get('a')!;
    chimei.characterId = 'chimei'; chimei.currentHp = chimei.maxHp = 2; chimei.gridIndex = 0;
    players.get('b')!.gridIndex = 1; players.get('c')!.gridIndex = 2; players.get('d')!.gridIndex = 4;
    resolveRound(players, actions(['a', { actionId: 'soul_capture' }], ['b', { actionId: 'charge' }], ['c', { actionId: 'charge' }], ['d', { actionId: 'charge' }]));
    const marked = Array.from(players.values()).filter((player) => player.buffs?.has('hellwalker')).map((player) => player.id);
    expect(marked).toEqual(['b', 'c']);
    expect(chimei.buffs?.has('hellwalker') ?? false).toBe(false);
  });

  it('allows one Chimei to apply Hellwalker to another Chimei', () => {
    const players = roster(['a', 1], ['b', 0]); const source = players.get('a')!; const otherChimei = players.get('b')!;
    source.characterId = 'chimei'; source.currentHp = source.maxHp = 2; source.gridIndex = 0;
    otherChimei.characterId = 'chimei'; otherChimei.currentHp = otherChimei.maxHp = 2; otherChimei.gridIndex = 2;
    resolveRound(players, actions(['a', { actionId: 'soul_reap', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(source.buffs?.has('hellwalker') ?? false).toBe(false);
    expect(otherChimei.buffs?.has('hellwalker')).toBe(true);
    expect(otherChimei.buffSourcePlayerIds?.hellwalker).toBe('a');
  });

  it('keeps Tremble on its selected stationary target and carries three layers into the next round', () => {
    const players = roster(['a', 1], ['b', 0]); const warrior = players.get('a')!; const target = players.get('b')!;
    warrior.characterId = 'warrior'; warrior.currentHp = warrior.maxHp = 2; target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'tremble', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.buffs?.has('vulnerability')).toBe(true);
    expect(target.buffStacks?.vulnerability).toBe(3);
  });

  it('does not let an inactive Quilon fire make another character resist Tremble', () => {
    const players = roster(['a', 1], ['b', 0]); const warrior = players.get('a')!; const target = players.get('b')!;
    warrior.characterId = 'warrior'; target.characterId = 'warrior'; target.currentHp = target.maxHp = 2;
    const fire: CombatBoardObject = { objectId: 'nilu_fire:b:1', definitionId: 'nilu_fire', kind: 'terrain', ownerPlayerId: 'b', sourceCharacterId: 'quilon', gridIndex: 1, stacks: 1, currentHp: 0, maxHp: 0, remainingTurns: 0, permanent: true };
    resolveRound(players, actions(['a', { actionId: 'tremble', targetId: 'b' }], ['b', { actionId: 'charge' }]), new Map([[fire.objectId, fire]]));
    expect(target.buffStacks?.vulnerability).toBe(3);
    expect(target.buffs?.has('nilu_resistance') ?? false).toBe(false);
  });

  it('allows zero-cost Bully while Regain Spirit blocks non-attack actions at zero energy', () => {
    const players = roster(['a', 0], ['b', 0]); const warrior = players.get('a')!;
    warrior.characterId = 'warrior'; warrior.buffs = new Set(['regain_spirit_lock']);
    expect(() => validateAction(warrior, { actionId: 'bully', targetId: 'b' }, players)).not.toThrow();
    expect(() => validateAction(warrior, { actionId: 'charge' }, players)).toThrow(/只能使用攻击技能/);
  });

  it('makes Soul Capture immune to attacks and grants at most one extra Soul', () => {
    const players = roster(['a', 0], ['b', 2], ['c', 0]); const chimei = players.get('a')!;
    chimei.characterId = 'chimei'; chimei.currentHp = chimei.maxHp = 2; chimei.resources.charge = 1; chimei.resources.soul = 0;
    players.get('b')!.resources.charge = 1;
    resolveRound(players, actions(['a', { actionId: 'soul_capture' }], ['b', { actionId: 'atomic_breath', targetId: 'a' }], ['c', { actionId: 'fist', targetId: 'a' }]));
    expect(chimei.currentHp).toBe(2);
    expect(chimei.resources.soul).toBe(2);
  });

  it('validates Hellwalker surcharge and applies Soul Reap speed and damage penalties', () => {
    const players = roster(['a', 2], ['b', 0]); const actor = players.get('a')!;
    actor.buffs = new Set(['hellwalker', 'soul_reap_debuff']); actor.resources.charge = 1;
    expect(() => validateAction(actor, { actionId: 'slash', targetId: 'b' }, players)).toThrow(/额外支付/);
    expect(() => validateAction(actor, { actionId: 'slash', targetId: 'b', extraResourceSpend: { charge: 1 } }, players)).not.toThrow();
    expect(buildResolutionSteps(actions(['a', { actionId: 'slash', targetId: 'b' }]), players)[0].speedPriority).toBe(0);
  });

  it('applies Soul Reap to damage level without reducing effect level', () => {
    const players = roster(['a', 1], ['b', 0]); const actor = players.get('a')!; const target = players.get('b')!;
    actor.buffs = new Set(['soul_reap_debuff']); actor.resources.energy = 1;
    target.currentHp = target.maxHp = 2;
    const result = resolveRound(players, actions(['a', { actionId: 'slash', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.currentHp).toBe(1);
    expect(result.summary.join('\n')).toContain('效果 1.5 / 伤害 1');
  });

  it('starts Deify control next round and ends it after the configured cumulative action cost', () => {
    const players = roster(['a', 3], ['b', 3]); const chimei = players.get('a')!; const target = players.get('b')!;
    chimei.characterId = 'chimei'; chimei.currentHp = chimei.maxHp = 2; chimei.resources.soul = 2;
    target.characterId = 'jiaosila'; target.currentHp = target.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'deify', targetId: 'b', power: 2, resourceSpend: { energy: 2 }, capturedSpeed: 2 }], ['b', { actionId: 'charge' }]));
    expect(target.buffStacks).toMatchObject({ converted: 2, conversion_threshold: 2 });
    expect(target.buffSourcePlayerIds?.converted).toBe('a');
    resolveRound(players, actions(['a', { actionId: 'defend' }], ['b', { actionId: 'slash', targetId: 'a' }]));
    expect(target.buffStacks?.converted).toBe(1);
    target.resources.energy = 1;
    resolveRound(players, actions(['a', { actionId: 'defend' }], ['b', { actionId: 'slash', targetId: 'a' }]));
    expect(target.buffs?.has('converted')).toBe(false);
  });

  it('resolves Warrior armor after block and consumes only the remaining damage', () => {
    const players = roster(['a', 3], ['b', 0]); const warrior = players.get('b')!;
    warrior.characterId = 'warrior'; warrior.currentHp = warrior.maxHp = 2;
    warrior.buffs = new Set(['armor']); warrior.buffStacks = { armor: 2 };
    resolveRound(players, actions(['a', { actionId: 'hangup' }], ['b', { actionId: 'defend' }]));
    expect(warrior.currentHp).toBe(2);
    expect(warrior.buffStacks).toMatchObject({ armor: 1 });
    expect(warrior.buffs?.has('defend_broken')).toBe(true);
  });

  it('lets true damage bypass Warrior armor', () => {
    const players = roster(['a', 0], ['b', 0]); const attacker = players.get('a')!; const warrior = players.get('b')!;
    attacker.characterId = 'ku'; attacker.resources.charge = 2; attacker.buffs = new Set(['tempered']); attacker.buffStacks = { tempered: 1 };
    warrior.characterId = 'warrior'; warrior.currentHp = warrior.maxHp = 2; warrior.buffs = new Set(['armor']); warrior.buffStacks = { armor: 2 };
    resolveRound(players, actions(['a', { actionId: 'void_pierce', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(warrior.currentHp).toBe(1);
    expect(warrior.buffStacks?.armor).toBe(2);
  });

  it('resolves effect and damage advantages independently in both directions', () => {
    const players = roster(['a', 0], ['b', 1]); const warrior = players.get('a')!; const target = players.get('b')!;
    warrior.characterId = 'warrior'; warrior.currentHp = warrior.maxHp = 2; warrior.resources.energy = 1;
    warrior.buffs = new Set(['strength']); warrior.buffStacks = { strength: 3 };
    target.currentHp = target.maxHp = 2;
    const result = resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'slash', targetId: 'a' }]));
    expect(target.currentHp).toBe(2);
    expect(warrior.currentHp).toBe(0);
    expect(result.summary.join('\n')).toContain('效果 2，附带效果成功');
    expect(result.summary.join('\n')).toContain('效果 1.5，附带效果失败');
    expect(result.summary.join('\n')).toContain('伤害差 1');
  });

  it('lets both attached effects succeed when opposing effect levels are equal', () => {
    const players = roster(['a', 0], ['b', 0]); const left = players.get('a')!; const right = players.get('b')!;
    left.currentHp = left.maxHp = 2; right.currentHp = right.maxHp = 2;

    const result = resolveRound(players, actions(
      ['a', { actionId: 'nebula_shock', targetId: 'b' }],
      ['b', { actionId: 'nebula_shock', targetId: 'a' }],
    ));

    expect(left.buffs?.has('shock')).toBe(true);
    expect(right.buffs?.has('shock')).toBe(true);
    expect(left.currentHp).toBe(1);
    expect(right.currentHp).toBe(1);
    expect(result.summary.join('\n').match(/附带效果成功/g)).toHaveLength(2);
  });

  it('lets only the strictly higher attached effect succeed even when the difference is below 0.5', () => {
    const template = actionById.get('nebula_shock')!;
    const higher = structuredClone(template) as ActionDefinition;
    const lower = structuredClone(template) as ActionDefinition;
    higher.id = 'test_effect_2'; higher.name = '2级效果'; higher.effectLevel = 2; higher.damageLevel = 0; higher.cost = {};
    lower.id = 'test_effect_1_75'; lower.name = '1.75级效果'; lower.effectLevel = 1.75; lower.damageLevel = 0; lower.cost = {};
    actionById.set(higher.id, higher); actionById.set(lower.id, lower);
    try {
      const players = roster(['a', 0], ['b', 0]); const winner = players.get('a')!; const loser = players.get('b')!;
      winner.currentHp = winner.maxHp = 2; loser.currentHp = loser.maxHp = 2;

      const result = resolveRound(players, actions(
        ['a', { actionId: higher.id, targetId: 'b' }],
        ['b', { actionId: lower.id, targetId: 'a' }],
      ));

      expect(Boolean(winner.buffs?.has('shock'))).toBe(false);
      expect(loser.buffs?.has('shock')).toBe(true);
      expect(winner.currentHp).toBe(2);
      expect(loser.currentHp).toBe(1);
      expect(result.summary.join('\n')).toContain('效果 2，附带效果成功');
      expect(result.summary.join('\n')).toContain('效果 1.8，附带效果失败');
    } finally {
      actionById.delete(higher.id); actionById.delete(lower.id);
    }
  });

  it('applies an attached effect when effect 2 wins even though damage 0.5 loses to damage 1.5', () => {
    const players = roster(['a', 0], ['b', 1]); const attacker = players.get('a')!; const target = players.get('b')!;
    attacker.characterId = 'warrior'; attacker.currentHp = attacker.maxHp = 2; attacker.resources.charge = 1;
    attacker.buffs = new Set(['strength', 'soul_reap_debuff']); attacker.buffStacks = { strength: 2, soul_reap_debuff: 1 };
    target.currentHp = target.maxHp = 2; target.resources.energy = 1;
    target.buffs = new Set(['swayed']); target.buffStacks = { swayed: 1 };
    const result = resolveRound(players, actions(['a', { actionId: 'nebula_shock', targetId: 'b' }], ['b', { actionId: 'slash', targetId: 'a' }]));
    expect(target.buffs?.has('shock')).toBe(true);
    expect(result.performance.a.damageStatesDealt).toBe(0);
    expect(result.summary.join('\n')).toContain('效果 2，附带效果成功');
    expect(result.summary.join('\n')).toContain('伤害 0.5 未高于 B 的斩伤害 1.5，不产生伤害');
  });

  it('does not turn Warrior strength into damage without an opposing attack', () => {
    const players = roster(['a', 0], ['b', 0]); const warrior = players.get('a')!; const target = players.get('b')!;
    warrior.characterId = 'warrior'; warrior.currentHp = warrior.maxHp = 2; warrior.resources.energy = 1;
    warrior.buffs = new Set(['strength']); warrior.buffStacks = { strength: 3 };
    target.characterId = 'warrior'; target.currentHp = target.maxHp = 2;
    target.buffs = new Set(['armor']); target.buffStacks = { armor: 0.5 };
    const result = resolveRound(players, actions(['a', { actionId: 'fist', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.currentHp).toBe(2);
    expect(target.buffs?.has('armor')).toBe(false);
    expect(result.summary.join('\n')).toContain('效果 2 / 伤害 0.5');
  });

  it('uses Shred final effect level as every hit damage level', () => {
    const players = roster(['a', 1], ['b', 0]); const warrior = players.get('a')!; const target = players.get('b')!;
    warrior.characterId = 'warrior'; warrior.currentHp = warrior.maxHp = 2; warrior.resources.energy = 1;
    warrior.buffs = new Set(['strength', 'shred_count']); warrior.buffStacks = { strength: 3, shred_count: 3 };
    target.currentHp = target.maxHp = 2;
    const result = resolveRound(players, actions(['a', { actionId: 'shred', targetId: 'b' }], ['b', { actionId: 'defend' }]));
    const summary = result.summary.join('\n');
    expect(target.currentHp).toBe(1);
    expect(target.buffs?.has('defend_broken')).toBe(true);
    expect(summary).toContain('第 1/4 段');
    expect(summary).toContain('效果 2.5 / 伤害 2.5');
    expect(summary).not.toContain('挡抵消了');
  });

  it('grows Warrior strength and Shred exactly once when higher round damage replaces an earlier hit', () => {
    const players = roster(['a', 1], ['b', 2], ['c', 0]); const warrior = players.get('c')!;
    warrior.characterId = 'warrior'; warrior.currentHp = warrior.maxHp = 2;
    resolveRound(players, actions(['a', { actionId: 'slash', targetId: 'c' }], ['b', { actionId: 'atomic_breath', targetId: 'c' }], ['c', { actionId: 'charge' }]));
    expect(warrior.currentHp).toBe(0);
    expect(warrior.buffStacks?.strength).toBe(2);
    expect(warrior.buffStacks?.shred_count).toBe(2);
    expect(warrior.buffs?.has('armor')).toBe(false);
  });

  it('uses dynamic repeated hits and enforces the Regain Spirit action lock', () => {
    const players = roster(['a', 2], ['b', 0]); const warrior = players.get('a')!; const target = players.get('b')!;
    warrior.characterId = 'warrior'; warrior.currentHp = warrior.maxHp = 2;
    target.currentHp = target.maxHp = 2; target.buffs = new Set(['armor', 'vulnerability']); target.buffStacks = { armor: 2, vulnerability: 2 };
    resolveRound(players, actions(['a', { actionId: 'dismantle', targetId: 'b' }], ['b', { actionId: 'charge' }]));
    expect(target.currentHp).toBe(1);
    warrior.buffs = new Set(['regain_spirit_lock']);
    expect(() => validateAction(warrior, { actionId: 'defend' }, players)).toThrow(/只能使用攻击/);
    expect(() => validateAction(warrior, { actionId: 'fist', targetId: 'b' }, players)).not.toThrow();
  });
});
