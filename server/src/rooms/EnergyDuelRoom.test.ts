import { MapSchema } from '@colyseus/schema';
import { describe, expect, it, vi } from 'vitest';
import { BuffState, EnergyDuelRoom, PlayerState, normalizeInitialTargetIds } from './EnergyDuelRoom.js';

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

  it('preserves the source of a player-scoped conversion buff', () => {
    const room = new EnergyDuelRoom() as any; const current = new MapSchema<BuffState>();
    room.storedBuffs.set('target', new Map());
    room.captureActiveBuffs('target', 'jiaosila', new Set(['converted', 'conversion_threshold']), current,
      { converted: 3, conversion_threshold: 3 }, {}, { converted: 'chimei', conversion_threshold: 'chimei' });
    const restored = new MapSchema<BuffState>(); room.syncActiveBuffs('target', 'jiaosila', restored);
    expect(restored.get('target:converted')).toMatchObject({ stacks: 3, sourcePlayerId: 'chimei' });
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
