import {
  buffById,
  characterById,
  gameConfig,
  type SessionIdentity,
  type SubmitActionMessage,
} from '@energy-duel/shared';
import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import { Client, Room, ServerError, matchMaker } from '@colyseus/core';
import { resolveRound, validateAction, type CombatPlayer, type RoundResult, type SubmittedAction } from '../game/RoundResolver.js';
import { ActionSubmissionStore } from '../game/ActionSubmissionStore.js';
import { sessionService } from '../services.js';
import { assertAccountAvailable, assignGridIndices, claimRoomCode, colorForAccount, isActionUnlocked, normalizeRoomCode, releaseRoomCode, tickScopedBuffs } from './roomSupport.js';

const NICKNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff]{1,16}$/;
const DEFAULT_CHARACTER_ID = 'default_character';
const DEFAULT_FORM_ID = 'base';
const PLAYER_BUFF_SCOPE = '*';

interface StoredBuff {
  buffId: string;
  stacks: number;
  remainingTurns: number;
  sourcePlayerId: string;
}

export class ResourceState extends Schema {
  @type('string') resourceId = '';
  @type('uint16') current = 0;
  @type('uint16') max = 0;
}

export class BuffState extends Schema {
  @type('string') instanceId = '';
  @type('string') buffId = '';
  @type('uint8') stacks = 1;
  @type('uint16') remainingTurns = 0;
  @type('string') sourcePlayerId = '';
}

export class PlayerState extends Schema {
  @type('string') playerId = '';
  @type('string') accountId = '';
  @type('string') username = '';
  @type('string') nickname = '';
  @type('uint8') gridIndex = 0;
  @type('uint32') color = 0xffffff;
  @type('boolean') ready = false;
  @type('boolean') alive = true;
  @type('uint16') currentHp = 1;
  @type('uint16') maxHp = 1;
  @type('string') characterId = DEFAULT_CHARACTER_ID;
  @type('string') currentFormId = DEFAULT_FORM_ID;
  @type({ map: ResourceState }) resources = new MapSchema<ResourceState>();
  @type({ map: BuffState }) buffs = new MapSchema<BuffState>();
  @type('boolean') submitted = false;
  @type('boolean') connected = true;
  @type('boolean') resultConfirmed = false;
}

export class RoundLogEntryState extends Schema {
  @type('uint16') gameNumber = 0;
  @type('uint16') round = 0;
  @type('string') time = '';
  @type('string') text = '';
}

export class DemoRoomState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type('string') phase: 'waiting' | 'choosing' | 'resolving' | 'finished' = 'waiting';
  @type('uint16') round = 0;
  @type('uint16') gameNumber = 0;
  @type('string') hostPlayerId = '';
  @type('string') lastResult = '等待玩家准备。';
  @type([RoundLogEntryState]) roundLog = new ArraySchema<RoundLogEntryState>();
}

export class EnergyDuelRoom extends Room {
  maxClients = 20;
  state = new DemoRoomState();
  private readonly actions = new ActionSubmissionStore();
  private destroying = false;
  private claimedRoomCode = '';
  private readonly storedBuffs = new Map<string, Map<string, Map<string, StoredBuff>>>();

  static async onAuth(token: string | undefined): Promise<SessionIdentity> {
    const identity = sessionService.validateToken(token);
    if (!identity) throw new ServerError(401, '会话无效或已过期');
    return identity;
  }

  async onCreate(options: { roomCode?: unknown }): Promise<void> {
    let roomCode: string;
    try { roomCode = normalizeRoomCode(options.roomCode); }
    catch (reason) { throw new ServerError(400, reason instanceof Error ? reason.message : '房间号无效'); }
    try { await claimRoomCode(roomCode, () => matchMaker.driver.has(roomCode)); }
    catch (reason) { throw new ServerError(409, reason instanceof Error ? reason.message : '房间号已被使用'); }
    this.claimedRoomCode = roomCode;
    this.roomId = roomCode;
    this.setMetadata({ roomCode });

    this.onMessage('set_ready', (client, payload: { ready?: unknown; requestId?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== 'waiting') return this.sendError(client, '当前不能修改准备状态', payload?.requestId, 'set_ready');
      player.ready = payload?.ready === true;
      this.sendSuccess(client, payload?.requestId, 'set_ready', player.ready ? '已准备' : '已取消准备');
    });
    this.onMessage('start_game', (client, payload: { requestId?: string }) => this.startGame(client, payload?.requestId));
    this.onMessage('submit_action', (client, payload: SubmitActionMessage) => this.submitAction(client, payload));
    this.onMessage('cancel_action', (client, payload: { requestId?: string }) => this.cancelAction(client, payload?.requestId));
    this.onMessage('acknowledge_result', (client, payload: { requestId?: string }) => this.acknowledgeResult(client, payload?.requestId));
    this.onMessage('ping', (client, payload: { sentAt?: number }) => client.send('pong', { sentAt: payload?.sentAt, serverAt: Date.now() }));
  }

  onDispose(): void {
    if (this.claimedRoomCode) releaseRoomCode(this.claimedRoomCode);
  }

  onJoin(client: Client, options: { nickname?: unknown }, identity: SessionIdentity): void {
    if (this.state.phase !== 'waiting') throw new ServerError(409, '游戏已经开始');
    try {
      assertAccountAvailable(this.state.players.values(), identity.accountId);
    } catch (reason) {
      throw new ServerError(409, reason instanceof Error ? reason.message : '账号重复');
    }
    const nickname = typeof options.nickname === 'string' ? options.nickname.trim() : '';
    if (!NICKNAME_PATTERN.test(nickname)) throw new ServerError(400, '昵称格式无效');

    const player = new PlayerState();
    player.playerId = client.sessionId;
    player.accountId = identity.accountId;
    player.username = identity.username;
    player.nickname = nickname;
    player.color = colorForAccount(identity.accountId, new Set(Array.from(this.state.players.values(), (value) => value.color)));
    for (const definition of gameConfig.resources) {
      const resource = new ResourceState();
      resource.resourceId = definition.id;
      player.resources.set(definition.id, resource);
    }
    this.state.players.set(client.sessionId, player);
    this.storedBuffs.set(client.sessionId, new Map());
    if (!this.state.hostPlayerId) this.state.hostPlayerId = client.sessionId;
    assignGridIndices(this.state.players.values());
  }

  async onDrop(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player || (this.state.phase !== 'choosing' && this.state.phase !== 'resolving')) return;
    player.connected = false;
    try { await this.allowReconnection(client, 30); } catch { /* onLeave completes departure */ }
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
  }

  onLeave(client: Client): void {
    const leavingPlayer = this.state.players.get(client.sessionId);
    if (!leavingPlayer) return;
    if (this.destroying) { this.state.players.delete(client.sessionId); return; }
    if (client.sessionId === this.state.hostPlayerId) {
      this.destroying = true;
      this.broadcast('room_closed', { message: '房主已离开，房间已销毁。' });
      void this.disconnect();
      return;
    }
    this.actions.cancel(client.sessionId);
    this.storedBuffs.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    assignGridIndices(this.state.players.values());
    if (this.state.phase === 'choosing' || this.state.phase === 'resolving') {
      this.actions.clear();
      this.state.phase = 'finished';
      this.state.lastResult = `${leavingPlayer.nickname} 已退出，游戏结束。`;
      for (const player of this.state.players.values()) player.submitted = false;
    } else if (this.state.phase === 'finished' && Array.from(this.state.players.values()).every((player) => player.resultConfirmed)) {
      this.resetToWaiting();
    }
  }

  private startGame(client: Client, requestId?: string): void {
    if (client.sessionId !== this.state.hostPlayerId) return this.sendError(client, '只有房主可以开始游戏', requestId, 'start_game');
    if (this.state.phase !== 'waiting') return this.sendError(client, '游戏已经开始', requestId, 'start_game');
    if (this.state.players.size < 2) return this.sendError(client, '至少需要两名玩家', requestId, 'start_game');
    if (Array.from(this.state.players.values()).some((player) => !player.ready || !player.connected)) {
      return this.sendError(client, '所有玩家准备后才能开始', requestId, 'start_game');
    }
    this.actions.clear();
    void this.lock();
    this.state.round = 1;
    this.state.gameNumber += 1;
    this.state.phase = 'choosing';
    this.state.lastResult = '游戏开始，请选择本回合行动。';
    for (const player of this.state.players.values()) {
      player.alive = true;
      player.currentHp = player.maxHp;
      player.submitted = false;
      player.resultConfirmed = false;
      player.buffs.clear();
      this.storedBuffs.set(player.playerId, new Map());
      for (const resource of player.resources.values()) resource.current = 0;
    }
    this.sendSuccess(client, requestId, 'start_game', '游戏开始');
  }

  private submitAction(client: Client, payload: SubmitActionMessage): void {
    const requestId = payload?.requestId;
    if (this.state.phase !== 'choosing') return this.sendError(client, '当前不能出招', requestId, 'submit_action');
    const player = this.state.players.get(client.sessionId);
    if (!player?.alive) return this.sendError(client, '已淘汰玩家不能出招', requestId, 'submit_action');
    if (player.submitted) return this.sendError(client, '请先撤销已经提交的行动', requestId, 'submit_action');
    if (typeof payload?.actionId !== 'string' || !this.isActionUnlocked(player, payload.actionId)) {
      return this.sendError(client, '当前形态未解锁该行动', requestId, 'submit_action');
    }
    const action: SubmittedAction = {
      actionId: payload.actionId,
      targetId: typeof payload.targetId === 'string' ? payload.targetId : undefined,
      targetIds: Array.isArray(payload.targetIds) && payload.targetIds.every((id) => typeof id === 'string') ? payload.targetIds : undefined,
      transformCharacterId: typeof payload.transformCharacterId === 'string' ? payload.transformCharacterId : undefined,
    };
    if (action.actionId === 'transform') {
      const transformations = characterById.get(player.characterId)?.transformations ?? [];
      if (!action.transformCharacterId || !transformations.includes(action.transformCharacterId)) {
        return this.sendError(client, '该变身尚未解锁', requestId, 'submit_action');
      }
      const targetCharacter = characterById.get(action.transformCharacterId);
      for (const [resourceId, amount] of Object.entries(targetCharacter?.transformationCost ?? {})) {
        if ((player.resources.get(resourceId)?.current ?? 0) < amount) return this.sendError(client, `变身所需的${resourceId}资源不足`, requestId, 'submit_action');
      }
    }
    try { validateAction(this.toCombatPlayer(player), action, this.combatPlayers()); }
    catch (reason) { return this.sendError(client, reason instanceof Error ? reason.message : '行动无效', requestId, 'submit_action'); }
    if (!this.actions.submit(client.sessionId, action)) return this.sendError(client, '请先撤销已经提交的行动', requestId, 'submit_action');
    player.submitted = true;
    this.sendSuccess(client, requestId, 'submit_action', '行动已提交，可在结算前撤销');
    const aliveIds = Array.from(this.state.players.values()).filter((candidate) => candidate.alive).map((candidate) => candidate.playerId);
    if (this.actions.allSubmitted(aliveIds)) this.resolveCurrentRound();
  }

  private cancelAction(client: Client, requestId?: string): void {
    if (this.state.phase !== 'choosing') return this.sendError(client, '结算已经开始，不能撤销', requestId, 'cancel_action');
    const player = this.state.players.get(client.sessionId);
    if (!player?.alive || !player.submitted || !this.actions.has(client.sessionId)) {
      return this.sendError(client, '没有可撤销的行动', requestId, 'cancel_action');
    }
    this.actions.cancel(client.sessionId);
    player.submitted = false;
    this.sendSuccess(client, requestId, 'cancel_action', '已撤销，可以重新选择');
  }

  private resolveCurrentRound(): void {
    const combatPlayers = this.combatPlayers();
    const result = resolveRound(combatPlayers, this.actions.asReadonlyMap());
    this.state.phase = 'resolving';
    const totalDurationMs = Math.max(450, result.steps.reduce((total, step) => total + step.durationMs, 0));
    this.broadcast('round_resolution', { round: this.state.round, steps: result.steps, totalDurationMs });
    this.clock.setTimeout(() => this.applyRoundResult(combatPlayers, result), totalDurationMs);
  }

  private applyRoundResult(combatPlayers: Map<string, CombatPlayer>, result: RoundResult): void {
    for (const [playerId, combatPlayer] of combatPlayers) {
      const synced = this.state.players.get(playerId);
      if (!synced) continue;
      const previousCharacterId = synced.characterId;
      this.captureActiveBuffs(playerId, previousCharacterId, combatPlayer.buffs ?? new Set(), synced.buffs);
      this.tickStoredBuffs(playerId);
      synced.currentHp = combatPlayer.currentHp;
      synced.maxHp = combatPlayer.maxHp;
      synced.alive = combatPlayer.alive;
      synced.characterId = combatPlayer.characterId ?? synced.characterId;
      synced.currentFormId = combatPlayer.currentFormId ?? synced.currentFormId;
      synced.submitted = false;
      for (const [resourceId, current] of Object.entries(combatPlayer.resources)) {
        const resource = synced.resources.get(resourceId);
        if (resource) resource.current = Math.max(0, current);
      }
      this.syncActiveBuffs(playerId, synced.characterId, synced.buffs);
    }
    this.state.lastResult = result.summary.join('\n');
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    for (const text of result.summary) {
      const entry = new RoundLogEntryState();
      entry.gameNumber = this.state.gameNumber;
      entry.round = this.state.round;
      entry.time = timestamp;
      entry.text = text;
      this.state.roundLog.push(entry);
    }
    while (this.state.roundLog.length > 200) this.state.roundLog.shift();
    this.actions.clear();
    if (this.finishIfDecided()) return;
    this.state.round += 1;
    this.state.phase = 'choosing';
  }

  private finishIfDecided(): boolean {
    const survivors = Array.from(this.state.players.values()).filter((player) => player.alive);
    if (survivors.length > 1) return false;
    this.state.phase = 'finished';
    this.state.lastResult += survivors.length === 1 ? `\n${survivors[0].nickname} 获胜！` : '\n无人存活，本局平局。';
    for (const player of this.state.players.values()) player.resultConfirmed = false;
    return true;
  }

  private acknowledgeResult(client: Client, requestId?: string): void {
    if (this.state.phase !== 'finished') return this.sendError(client, '当前没有待确认的结算', requestId, 'acknowledge_result');
    const player = this.state.players.get(client.sessionId);
    if (!player) return this.sendError(client, '玩家不在房间中', requestId, 'acknowledge_result');
    player.resultConfirmed = true;
    this.sendSuccess(client, requestId, 'acknowledge_result', '已确认结算');
    if (Array.from(this.state.players.values()).every((candidate) => candidate.resultConfirmed)) this.resetToWaiting();
  }

  private resetToWaiting(): void {
    this.actions.clear();
    void this.unlock();
    this.state.phase = 'waiting';
    this.state.round = 0;
    this.state.lastResult = '上一局已结束，可以重新准备。';
    for (const player of this.state.players.values()) {
      player.ready = false;
      player.resultConfirmed = false;
      player.submitted = false;
      player.alive = true;
      player.characterId = DEFAULT_CHARACTER_ID;
      player.currentFormId = DEFAULT_FORM_ID;
      player.maxHp = 1;
      player.currentHp = 1;
      player.buffs.clear();
      this.storedBuffs.set(player.playerId, new Map());
      for (const resource of player.resources.values()) resource.current = 0;
    }
  }

  private isActionUnlocked(player: PlayerState, actionId: string): boolean {
    return isActionUnlocked(player.characterId, player.currentFormId, actionId, Array.from(player.buffs.values(), (buff) => buff.buffId));
  }

  private combatPlayers(): Map<string, CombatPlayer> {
    return new Map(Array.from(this.state.players.entries(), ([id, player]) => [id, this.toCombatPlayer(player)]));
  }

  private toCombatPlayer(player: PlayerState): CombatPlayer {
    return {
      id: player.playerId,
      nickname: player.nickname,
      currentHp: player.currentHp,
      maxHp: player.maxHp,
      alive: player.alive,
      characterId: player.characterId,
      currentFormId: player.currentFormId,
      resources: Object.fromEntries(Array.from(player.resources.entries(), ([id, resource]) => [id, resource.current])),
      buffs: new Set(Array.from(player.buffs.values(), (buff) => buff.buffId)),
    };
  }

  private captureActiveBuffs(playerId: string, characterId: string, activeBuffIds: ReadonlySet<string>, syncedBuffs: MapSchema<BuffState>): void {
    const scopes = this.storedBuffs.get(playerId) ?? new Map<string, Map<string, StoredBuff>>();
    this.storedBuffs.set(playerId, scopes);
    const priorById = new Map(Array.from(syncedBuffs.values(), (buff) => [buff.buffId, buff]));
    const nextCharacter = new Map<string, StoredBuff>();
    const nextPlayer = new Map<string, StoredBuff>();
    for (const buffId of activeBuffIds) {
      const definition = buffById.get(buffId);
      const scopeId = definition?.scope === 'player' ? PLAYER_BUFF_SCOPE : characterId;
      const existing = scopes.get(scopeId)?.get(buffId);
      const synced = priorById.get(buffId);
      const stored: StoredBuff = existing ?? {
        buffId,
        stacks: synced?.stacks ?? 1,
        remainingTurns: synced?.remainingTurns || definition?.durationTurns || 0,
        sourcePlayerId: synced?.sourcePlayerId || playerId,
      };
      (scopeId === PLAYER_BUFF_SCOPE ? nextPlayer : nextCharacter).set(buffId, stored);
    }
    scopes.set(characterId, nextCharacter);
    scopes.set(PLAYER_BUFF_SCOPE, nextPlayer);
  }

  private tickStoredBuffs(playerId: string): void {
    tickScopedBuffs(this.storedBuffs.get(playerId)?.values() ?? [], (buffId) => buffById.get(buffId)?.durationTurns);
  }

  private syncActiveBuffs(playerId: string, characterId: string, target: MapSchema<BuffState>): void {
    target.clear();
    const scopes = this.storedBuffs.get(playerId);
    const active = [...(scopes?.get(PLAYER_BUFF_SCOPE)?.values() ?? []), ...(scopes?.get(characterId)?.values() ?? [])];
    for (const stored of active) {
      const buff = new BuffState();
      buff.instanceId = `${playerId}:${stored.buffId}`;
      buff.buffId = stored.buffId;
      buff.stacks = stored.stacks;
      buff.remainingTurns = Math.max(0, stored.remainingTurns);
      buff.sourcePlayerId = stored.sourcePlayerId;
      target.set(buff.instanceId, buff);
    }
  }

  private sendError(client: Client, message: string, requestId?: string, command = 'game'): void {
    client.send('game_error', { message });
    client.send('command_result', { requestId, command, ok: false, message });
  }

  private sendSuccess(client: Client, requestId: string | undefined, command: string, message: string): void {
    client.send('command_result', { requestId, command, ok: true, message });
  }
}
