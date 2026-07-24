import { MapSchema } from '@colyseus/schema';
import { describe, expect, it, vi } from 'vitest';
import { BoardObjectState, BuffState, EnergyDuelRoom, PlayerState, normalizeInitialTargetIds } from './EnergyDuelRoom.js';

describe('EnergyDuelRoom submitted targets', () => {
  it('keeps an empty initial target list pending for deferred actions', () => {
    expect(normalizeInitialTargetIds([])).toBeUndefined();
    expect(normalizeInitialTargetIds(['target'])).toEqual(['target']);
  });

  it('prompts the controller for a dynamically deferred actor', () => {
    const room = new EnergyDuelRoom() as any;
    const actor = new PlayerState(); actor.playerId = 'dummy'; actor.accountId = 'dummy'; actor.controllerPlayerId = 'host'; actor.characterId = 'ao';
    const mastery = new BuffState(); mastery.instanceId = 'dummy:ao_mastery'; mastery.buffId = 'ao_mastery'; mastery.stacks = 2; mastery.sourcePlayerId = 'dummy';
    actor.buffs.set(mastery.instanceId, mastery); room.state.players.set(actor.playerId, actor);
    room.actions.submit(actor.playerId, { actionId: 'steal' });
    const send = vi.fn(); room.sendDeferredPrompt({ sessionId: 'host', send });
    expect(send).toHaveBeenCalledWith('deferred_action_required', expect.objectContaining({ actorPlayerId: 'dummy', actionId: 'steal' }));
  });
});

describe('EnergyDuelRoom host reconnection', () => {
  it('keeps a host seat for an unexpected waiting-room disconnect', async () => {
    const room = new EnergyDuelRoom() as any;
    const host = new PlayerState(); host.playerId = 'host'; host.connected = true;
    room.state.hostPlayerId = 'host'; room.state.phase = 'waiting'; room.state.players.set('host', host);
    room.emitRoomNotice = vi.fn(); room.allowReconnection = vi.fn().mockResolvedValue(undefined);

    await room.onDrop({ sessionId: 'host' });

    expect(host.connected).toBe(false);
    expect(room.emitRoomNotice).toHaveBeenCalledWith('disconnect', host);
    expect(room.allowReconnection).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'host' }), 30);
  });
});

describe('EnergyDuelRoom departures during a game', () => {
  it.each(['choosing', 'deferred', 'resolving', 'learning'] as const)(
    'keeps the %s game and board unchanged when an eliminated non-host leaves',
    (phase) => {
      const room = new EnergyDuelRoom() as any;
      const host = new PlayerState(); host.playerId = 'host'; host.nickname = '房主'; host.gridIndex = 0; host.alive = true;
      const eliminated = new PlayerState(); eliminated.playerId = 'eliminated'; eliminated.nickname = '观战者'; eliminated.gridIndex = 2; eliminated.alive = false;
      const survivor = new PlayerState(); survivor.playerId = 'survivor'; survivor.nickname = '存活者'; survivor.gridIndex = 4; survivor.alive = true;
      const terrain = new BoardObjectState(); terrain.objectId = 'terrain:stable'; terrain.definitionId = 'dominion'; terrain.gridIndex = 3;
      room.state.hostPlayerId = host.playerId;
      room.state.phase = phase;
      room.state.lastResult = '本局继续。';
      room.state.players.set(host.playerId, host);
      room.state.players.set(eliminated.playerId, eliminated);
      room.state.players.set(survivor.playerId, survivor);
      room.state.boardObjects.set(terrain.objectId, terrain);
      room.actions.submit(host.playerId, { actionId: 'charge' });
      room.emitRoomNotice = vi.fn();

      room.onLeave({ sessionId: eliminated.playerId });

      expect(room.state.phase).toBe(phase);
      expect(room.state.lastResult).toBe('本局继续。');
      expect(Array.from(room.state.players.values(), (player: PlayerState) => [player.playerId, player.gridIndex])).toEqual([
        ['host', 0],
        ['eliminated', 2],
        ['survivor', 4],
      ]);
      expect(room.state.boardObjects.get(terrain.objectId)).toBe(terrain);
      expect(room.actions.has(host.playerId)).toBe(true);
      expect(eliminated.connected).toBe(false);
      expect(room.departedEliminatedPlayerIds.has(eliminated.playerId)).toBe(true);
    },
  );

  it('retains the existing game-ending behavior when a living non-host leaves', () => {
    const room = new EnergyDuelRoom() as any;
    const host = new PlayerState(); host.playerId = 'host'; host.alive = true;
    const guest = new PlayerState(); guest.playerId = 'guest'; guest.nickname = '离场者'; guest.alive = true;
    room.state.hostPlayerId = host.playerId;
    room.state.phase = 'choosing';
    room.state.players.set(host.playerId, host);
    room.state.players.set(guest.playerId, guest);
    room.actions.submit(host.playerId, { actionId: 'charge' });
    room.emitRoomNotice = vi.fn();

    room.onLeave({ sessionId: guest.playerId });

    expect(room.state.players.has(guest.playerId)).toBe(false);
    expect(room.state.phase).toBe('finished');
    expect(room.state.lastResult).toBe('离场者 已退出，游戏结束。');
    expect(room.actions.has(host.playerId)).toBe(false);
  });

  it('does not wait for a departed spectator to confirm results and removes the snapshot on reset', () => {
    const room = new EnergyDuelRoom() as any;
    const host = new PlayerState(); host.playerId = 'host'; host.alive = true;
    const eliminated = new PlayerState(); eliminated.playerId = 'eliminated'; eliminated.alive = false;
    room.state.phase = 'finished';
    room.state.players.set(host.playerId, host);
    room.state.players.set(eliminated.playerId, eliminated);
    room.departedEliminatedPlayerIds.add(eliminated.playerId);
    room.sendSuccess = vi.fn();
    room.unlock = vi.fn().mockResolvedValue(undefined);

    room.acknowledgeResult({ sessionId: host.playerId });

    expect(room.state.phase).toBe('waiting');
    expect(room.state.players.has(eliminated.playerId)).toBe(false);
    expect(room.state.players.has(host.playerId)).toBe(true);
    expect(room.departedEliminatedPlayerIds.size).toBe(0);
  });
});

describe('EnergyDuelRoom character-scoped buffs', () => {
  it('keeps permanent Warrior buffs while finite buffs continue ticking', () => {
    const room = new EnergyDuelRoom() as any;
    const player = new PlayerState(); player.playerId = 'p'; player.characterId = 'warrior';
    const armor = new BuffState(); armor.instanceId = 'p:armor'; armor.buffId = 'armor'; armor.stacks = 2.5; armor.permanent = true; armor.sourcePlayerId = 'p';
    const strength = new BuffState(); strength.instanceId = 'p:strength'; strength.buffId = 'strength'; strength.stacks = 3; strength.permanent = true; strength.sourcePlayerId = 'p';
    const lock = new BuffState(); lock.instanceId = 'p:regain_spirit_lock'; lock.buffId = 'regain_spirit_lock'; lock.stacks = 1; lock.remainingTurns = 2; lock.permanent = false; lock.sourcePlayerId = 'p';
    player.buffs.set(armor.instanceId, armor); player.buffs.set(strength.instanceId, strength); player.buffs.set(lock.instanceId, lock);

    const combat = room.toCombatPlayer(player);
    expect(combat.buffRemainingTurns).toEqual({ regain_spirit_lock: 2 });
    room.captureActiveBuffs('p', 'warrior', combat.buffs, player.buffs, combat.buffStacks, combat.buffRemainingTurns, combat.buffSourcePlayerIds);
    room.tickStoredBuffs('p');

    const restored = new MapSchema<BuffState>(); room.syncActiveBuffs('p', 'warrior', restored);
    expect(restored.get('p:armor')).toMatchObject({ stacks: 2.5, permanent: true, remainingTurns: 0 });
    expect(restored.get('p:strength')).toMatchObject({ stacks: 3, permanent: true, remainingTurns: 0 });
    expect(restored.get('p:regain_spirit_lock')).toMatchObject({ permanent: false, remainingTurns: 1 });
  });

  it('keeps layer-based Vulnerability when combat state returns to the room', () => {
    const room = new EnergyDuelRoom() as any; const player = new PlayerState();
    player.playerId = 'target'; player.characterId = 'warrior'; room.storedBuffs.set(player.playerId, new Map());
    room.captureActiveBuffs(player.playerId, player.characterId, new Set(['vulnerability']), player.buffs, { vulnerability: 3 });
    room.tickStoredBuffs(player.playerId);
    room.syncActiveBuffs(player.playerId, player.characterId, player.buffs);
    expect(player.buffs.get('target:vulnerability')).toMatchObject({ stacks: 3, permanent: true });
  });

  it('does not heal a near-death player while restoring the transformed character', () => {
    const room = new EnergyDuelRoom() as any;
    const player = new PlayerState(); player.playerId = 'p'; player.characterId = 'star_god'; player.currentHp = 1; player.maxHp = 2;
    room.storedBuffs.set('p', new Map());
    room.restoreCharacterHealth('p', player);
    expect(player.currentHp).toBe(1);
    expect(player.maxHp).toBe(2);
  });

  it('hides a Gonggang buff after switching away and restores it after switching back', () => {
    const room = new EnergyDuelRoom() as any;
    const current = new MapSchema<BuffState>();
    const axe = new BuffState(); axe.instanceId = 'p:axe_raised'; axe.buffId = 'axe_raised'; axe.sourcePlayerId = 'p';
    current.set(axe.instanceId, axe);
    room.captureActiveBuffs('p', 'gonggang', new Set(['axe_raised']), current);
    room.tickStoredBuffs('p');

    const jiaosila = new MapSchema<BuffState>();
    room.syncActiveBuffs('p', 'jiaosila', jiaosila);
    expect(jiaosila.size).toBe(0);
    room.captureActiveBuffs('p', 'jiaosila', new Set(), jiaosila);

    const gonggang = new MapSchema<BuffState>();
    room.syncActiveBuffs('p', 'gonggang', gonggang);
    expect(Array.from(gonggang.values(), (buff) => buff.buffId)).toEqual(['axe_raised']);
  });

  it('preserves fractional Regent forge stacks across character switches', () => {
    const room = new EnergyDuelRoom() as any;
    const current = new MapSchema<BuffState>();
    const forged = new BuffState(); forged.instanceId = 'p:sovereign_blade_forged'; forged.buffId = 'sovereign_blade_forged'; forged.stacks = 2.5; forged.sourcePlayerId = 'p';
    current.set(forged.instanceId, forged);
    room.captureActiveBuffs('p', 'regent', new Set(['sovereign_blade_forged']), current, { sovereign_blade_forged: 2.5 });
    const away = new MapSchema<BuffState>();
    room.syncActiveBuffs('p', 'jiaosila', away);
    expect(away.size).toBe(0);
    const restored = new MapSchema<BuffState>();
    room.syncActiveBuffs('p', 'regent', restored);
    expect(restored.get('p:sovereign_blade_forged')?.stacks).toBe(2.5);
  });

  it('removes Star God progress when finite transcendence expires', () => {
    const room = new EnergyDuelRoom() as any; const current = new MapSchema<BuffState>();
    const transcendence = new BuffState(); transcendence.instanceId = 'p:transcendence'; transcendence.buffId = 'transcendence'; transcendence.remainingTurns = 1; transcendence.sourcePlayerId = 'p';
    const progress = new BuffState(); progress.instanceId = 'p:transcendence_progress'; progress.buffId = 'transcendence_progress'; progress.stacks = 3; progress.sourcePlayerId = 'p';
    current.set(transcendence.instanceId, transcendence); current.set(progress.instanceId, progress);
    room.captureActiveBuffs('p', 'star_god', new Set(['transcendence', 'transcendence_progress']), current, { transcendence: 1, transcendence_progress: 3 }, { transcendence: 1 });
    room.tickStoredBuffs('p');
    const restored = new MapSchema<BuffState>(); room.syncActiveBuffs('p', 'star_god', restored);
    expect(Array.from(restored.values(), (buff) => buff.buffId)).toEqual([]);
  });
});

describe('EnergyDuelRoom training actors', () => {
  it('creates a server-owned dummy controlled by the room host', () => {
    const room = new EnergyDuelRoom() as any;
    const host = new PlayerState(); host.playerId = 'host'; host.controllerPlayerId = 'host'; host.accountId = 'account';
    room.state.players.set(host.playerId, host);
    const dummy = room.createTrainingDummy('host') as PlayerState;
    expect(dummy.isTrainingDummy).toBe(true);
    expect(dummy.controllerPlayerId).toBe('host');
    expect(dummy.playerId).not.toBe(host.playerId);
    expect(dummy.resources.size).toBeGreaterThan(0);
    expect(Array.from(room.state.players.values(), (player: PlayerState) => player.gridIndex)).toEqual([0, 2]);
  });

  it('authorizes only the synchronized controller to act for a dummy', () => {
    const room = new EnergyDuelRoom() as any; room.state.roomMode = 'training';
    const dummy = new PlayerState(); dummy.playerId = 'dummy'; dummy.controllerPlayerId = 'host'; room.state.players.set(dummy.playerId, dummy);
    expect(room.authorizedActor({ sessionId: 'host' }, 'dummy')).toBe(dummy);
    expect(room.authorizedActor({ sessionId: 'intruder' }, 'dummy')).toBeUndefined();
  });
});

describe('EnergyDuelRoom Chimei control', () => {
  it('authorizes a converted standard-room actor only for the synchronized Chimei controller', () => {
    const room = new EnergyDuelRoom() as any;
    const actor = new PlayerState(); actor.playerId = 'target'; actor.controllerPlayerId = 'chimei'; room.state.players.set(actor.playerId, actor);
    expect(room.authorizedActor({ sessionId: 'chimei' }, 'target')).toBe(actor);
    expect(room.authorizedActor({ sessionId: 'target' }, 'target')).toBeUndefined();
  });

  it('keeps a real player controllable when the converting Chimei is a host-controlled training dummy', () => {
    const room = new EnergyDuelRoom() as any; room.state.roomMode = 'training';
    const host = new PlayerState(); host.playerId = 'host'; host.controllerPlayerId = 'host'; host.alive = true;
    const dummy = new PlayerState(); dummy.playerId = 'dummy'; dummy.controllerPlayerId = 'host'; dummy.characterId = 'chimei'; dummy.isTrainingDummy = true; dummy.alive = true;
    const converted = new BuffState(); converted.instanceId = 'host:converted'; converted.buffId = 'converted'; converted.sourcePlayerId = 'dummy';
    host.buffs.set(converted.instanceId, converted);
    room.state.players.set(host.playerId, host); room.state.players.set(dummy.playerId, dummy);

    room.syncConvertedControllers();

    expect(host.controllerPlayerId).toBe('host');
    expect(dummy.controllerPlayerId).toBe('host');
    expect(room.authorizedActor({ sessionId: 'host' }, 'host')).toBe(host);
    expect(room.authorizedActor({ sessionId: 'host' }, 'dummy')).toBe(dummy);
  });

  it('preserves the source of a player-scoped conversion buff', () => {
    const room = new EnergyDuelRoom() as any; const current = new MapSchema<BuffState>();
    room.storedBuffs.set('target', new Map());
    room.captureActiveBuffs('target', 'jiaosila', new Set(['converted', 'conversion_threshold']), current,
      { converted: 3, conversion_threshold: 3 }, {}, { converted: 'chimei', conversion_threshold: 'chimei' });
    const restored = new MapSchema<BuffState>(); room.syncActiveBuffs('target', 'jiaosila', restored);
    expect(restored.get('target:converted')).toMatchObject({ stacks: 3, sourcePlayerId: 'chimei' });
  });

  it('never assigns the Resentment mark to the Chimei source', () => {
    const room = new EnergyDuelRoom() as any;
    const chimei = new PlayerState(); chimei.playerId = 'chimei'; chimei.characterId = 'chimei'; chimei.alive = true; chimei.gridIndex = 0;
    const target = new PlayerState(); target.playerId = 'target'; target.characterId = 'warrior'; target.alive = true; target.gridIndex = 2;
    room.state.players.set(chimei.playerId, chimei); room.state.players.set(target.playerId, target);
    room.storedBuffs.set(chimei.playerId, new Map()); room.storedBuffs.set(target.playerId, new Map());
    room.assignResentmentMark();
    expect(Array.from(chimei.buffs.values()).some((buff: BuffState) => buff.buffId === 'resentment_mark')).toBe(false);
    expect(Array.from(target.buffs.values()).some((buff: BuffState) => buff.buffId === 'resentment_mark')).toBe(true);
  });

  it('allows the Resentment source to mark another Chimei', () => {
    const room = new EnergyDuelRoom() as any;
    const source = new PlayerState(); source.playerId = 'source'; source.characterId = 'chimei'; source.alive = true; source.gridIndex = 0;
    const otherChimei = new PlayerState(); otherChimei.playerId = 'other'; otherChimei.characterId = 'chimei'; otherChimei.alive = true; otherChimei.gridIndex = 2;
    room.state.players.set(source.playerId, source); room.state.players.set(otherChimei.playerId, otherChimei);
    room.storedBuffs.set(source.playerId, new Map()); room.storedBuffs.set(otherChimei.playerId, new Map());
    room.assignResentmentMark();
    expect(Array.from(source.buffs.values()).some((buff: BuffState) => buff.buffId === 'resentment_mark')).toBe(false);
    expect(Array.from(otherChimei.buffs.values()).find((buff: BuffState) => buff.buffId === 'resentment_mark')).toMatchObject({ sourcePlayerId: 'source' });
  });
});

describe('EnergyDuelRoom emotes', () => {
  it('broadcasts every validated emote without a send interval', () => {
    const room = new EnergyDuelRoom() as any;
    const player = new PlayerState(); player.playerId = 'p'; player.accountId = 'account';
    room.state.players.set(player.playerId, player);
    room.broadcast = vi.fn();
    const client = { sessionId: 'p', send: vi.fn() };

    room.sendEmote(client, { emoteId: 'laugh', requestId: 'emote-1' });
    expect(room.broadcast).toHaveBeenCalledWith('room_emote', expect.objectContaining({ eventId: 'emote-1', playerId: 'p', emoteId: 'laugh' }));
    room.sendEmote(client, { emoteId: 'not-an-emote' });
    room.sendEmote(client, { emoteId: 'laugh', requestId: 'emote-2' });
    expect(room.broadcast).toHaveBeenCalledTimes(2);
    expect(client.send).toHaveBeenCalledWith('command_result', expect.objectContaining({ ok: false, command: 'send_emote' }));
  });
});

describe('EnergyDuelRoom game reset', () => {
  it('restores circular starting cells after a finished game', () => {
    const room = new EnergyDuelRoom() as any;
    for (const [id, gridIndex] of [['a', 1], ['b', 3], ['c', 5]] as const) {
      const player = new PlayerState(); player.playerId = id; player.accountId = id; player.controllerPlayerId = id; player.gridIndex = gridIndex;
      room.state.players.set(id, player);
    }
    room.resetToWaiting();
    expect(Array.from(room.state.players.values(), (player: PlayerState) => player.gridIndex)).toEqual([0, 2, 4]);
  });
});

describe('EnergyDuelRoom Devour learning', () => {
  function learningRoom() {
    const room = new EnergyDuelRoom() as any;
    const learner = new PlayerState(); learner.playerId = 'a'; learner.accountId = 'a'; learner.controllerPlayerId = 'a'; learner.characterId = 'ye_qingxian'; learner.currentFormId = 'base'; learner.alive = true;
    const target = new PlayerState(); target.playerId = 'b'; target.accountId = 'b'; target.controllerPlayerId = 'b'; target.nickname = '战士'; target.characterId = 'warrior'; target.currentFormId = 'base'; target.alive = false;
    room.state.players.set('a', learner); room.state.players.set('b', target); room.state.phase = 'learning'; room.state.round = 1;
    room.prepareLearning({ learningTargets: [{ learnerPlayerId: 'a', targetPlayerId: 'b' }] });
    return { room, learner, client: { sessionId: 'a', send: vi.fn() } };
  }

  it('learns one server-offered skill and unlocks it only for Ye Qingxian', () => {
    const { room, learner, client } = learningRoom();
    const option = room.pendingLearning.get('a')[0].actionIds[0];
    room.submitLearning(client, { learnerPlayerId: 'a', targetPlayerId: 'b', actionId: option, requestId: 'learn-1' });
    expect(Array.from(learner.learnedActionIds)).toContain(option);
    expect(room.isActionUnlocked(learner, option)).toBe(true);
    learner.characterId = 'star_god';
    expect(room.isActionUnlocked(learner, option)).toBe(false);
    expect(room.state.phase).toBe('choosing');
    expect(room.state.round).toBe(2);
  });

  it('allows the learner to explicitly skip the opportunity', () => {
    const { room, learner, client } = learningRoom();
    room.submitLearning(client, { learnerPlayerId: 'a', targetPlayerId: 'b', skip: true, requestId: 'skip-1' });
    expect(learner.learnedActionIds).toHaveLength(0);
    expect(learner.learnedPassiveIds).toHaveLength(0);
    expect(room.pendingLearning.size).toBe(0);
    expect(room.state.phase).toBe('choosing');
  });

  it('prompts each queued opportunity in order before advancing the round', () => {
    const { room, learner, client } = learningRoom();
    const second = new PlayerState(); second.playerId = 'c'; second.accountId = 'c'; second.controllerPlayerId = 'c'; second.nickname = '凹'; second.characterId = 'ao'; second.currentFormId = 'base'; second.alive = false;
    room.state.players.set('c', second);
    room.prepareLearning({ learningTargets: [{ learnerPlayerId: 'a', targetPlayerId: 'b' }, { learnerPlayerId: 'a', targetPlayerId: 'c' }] });

    room.submitLearning(client, { learnerPlayerId: 'a', targetPlayerId: 'b', skip: true, requestId: 'skip-first' });

    expect(room.pendingLearning.get('a')).toHaveLength(1);
    expect(room.pendingLearning.get('a')[0].targetPlayerId).toBe('c');
    expect(room.state.phase).toBe('learning');
    expect(room.state.round).toBe(1);
  });

  it('sends a learning prompt to a training dummy controller and preserves its reconnect seat', async () => {
    const { room } = learningRoom();
    const learner = room.state.players.get('a'); learner.playerId = 'dummy'; learner.controllerPlayerId = 'host'; learner.isTrainingDummy = true;
    room.state.players.delete('a'); room.state.players.set('dummy', learner);
    room.pendingLearning.clear(); room.pendingLearning.set('dummy', [{ targetPlayerId: 'b', targetNickname: '战士', actionIds: ['bully'], passiveIds: [] }]);
    const send = vi.fn();
    room.sendLearningPrompt({ sessionId: 'host', send });
    expect(send).toHaveBeenCalledWith('learning_required', expect.objectContaining({ learnerPlayerId: 'dummy', targetPlayerId: 'b' }));

    const player = new PlayerState(); player.playerId = 'guest'; player.connected = true; room.state.players.set('guest', player);
    room.allowReconnection = vi.fn().mockResolvedValue(undefined); room.emitRoomNotice = vi.fn();
    await room.onDrop({ sessionId: 'guest' });
    expect(player.connected).toBe(false);
    expect(room.allowReconnection).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'guest' }), 30);
  });
});
