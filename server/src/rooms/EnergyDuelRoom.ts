import { characterById, gameConfig, type SessionIdentity } from '@energy-duel/shared';
import { MapSchema, Schema, type } from '@colyseus/schema';
import { Client, Room, ServerError } from 'colyseus';
import { resolveRound, validateAction, type CombatPlayer, type SubmittedAction } from '../game/RoundResolver.js';
import { ActionSubmissionStore } from '../game/ActionSubmissionStore.js';
import { sessionService } from '../services.js';
import { assertAccountAvailable, assignGridIndices, colorForAccount } from './roomSupport.js';

const NICKNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff]{1,16}$/;
const DEFAULT_CHARACTER_ID = 'default_character';
const DEFAULT_FORM_ID = 'base';

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
}

export class DemoRoomState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type('string') phase: 'waiting' | 'choosing' | 'finished' = 'waiting';
  @type('uint16') round = 0;
  @type('string') hostPlayerId = '';
  @type('string') lastResult = '等待玩家准备。';
}

export class EnergyDuelRoom extends Room {
  maxClients = 20;
  state = new DemoRoomState();
  private readonly actions = new ActionSubmissionStore();
  private destroying = false;

  static async onAuth(token: string | undefined): Promise<SessionIdentity> {
    const identity = sessionService.validateToken(token);
    if (!identity) throw new ServerError(401, '会话无效或已过期');
    return identity;
  }

  onCreate(): void {
    this.onMessage('set_ready', (client, payload: { ready?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== 'waiting') return;
      player.ready = payload?.ready === true;
    });
    this.onMessage('start_game', (client) => this.startGame(client));
    this.onMessage('submit_action', (client, payload: { actionId?: unknown; targetId?: unknown }) => {
      this.submitAction(client, payload);
    });
    this.onMessage('cancel_action', (client) => this.cancelAction(client));
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
      resource.current = 0;
      resource.max = 0;
      player.resources.set(definition.id, resource);
    }
    this.state.players.set(client.sessionId, player);
    if (!this.state.hostPlayerId) this.state.hostPlayerId = client.sessionId;
    assignGridIndices(this.state.players.values());
  }

  async onDrop(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (this.state.phase !== 'choosing') return;
    player.connected = false;
    try {
      await this.allowReconnection(client, 30);
    } catch {
      // Colyseus continues through onLeave when the reservation expires.
    }
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
  }

  onLeave(client: Client): void {
    const leavingPlayer = this.state.players.get(client.sessionId);
    if (!leavingPlayer) return;
    if (this.destroying) {
      this.state.players.delete(client.sessionId);
      return;
    }
    if (client.sessionId === this.state.hostPlayerId) {
      this.destroying = true;
      this.broadcast('room_closed', { message: '房主已离开，房间已销毁。' });
      void this.disconnect();
      return;
    }
    this.actions.cancel(client.sessionId);
    this.state.players.delete(client.sessionId);
    assignGridIndices(this.state.players.values());
    if (this.state.phase === 'choosing') {
      this.actions.clear();
      this.state.phase = 'finished';
      this.state.lastResult = `${leavingPlayer.nickname} 已退出，游戏结束。`;
      for (const player of this.state.players.values()) player.submitted = false;
    }
  }

  private startGame(client: Client): void {
    if (client.sessionId !== this.state.hostPlayerId) return this.sendError(client, '只有房主可以开始游戏');
    if (this.state.phase !== 'waiting') return this.sendError(client, '游戏已经开始');
    if (this.state.players.size < 2) return this.sendError(client, '至少需要两名玩家');
    if (Array.from(this.state.players.values()).some((player) => !player.ready || !player.connected)) {
      return this.sendError(client, '所有玩家准备后才能开始');
    }
    this.actions.clear();
    void this.lock();
    this.state.round = 1;
    this.state.phase = 'choosing';
    this.state.lastResult = '游戏开始，请选择本回合行动。';
    for (const player of this.state.players.values()) {
      player.alive = true;
      player.currentHp = player.maxHp;
      player.submitted = false;
      player.buffs.clear();
      for (const resource of player.resources.values()) resource.current = 0;
    }
  }

  private submitAction(client: Client, payload: { actionId?: unknown; targetId?: unknown }): void {
    if (this.state.phase !== 'choosing') return this.sendError(client, '当前不能出招');
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) return this.sendError(client, '已淘汰玩家不能出招');
    if (player.submitted) return this.sendError(client, '请先撤销已经确认的行动');
    if (typeof payload?.actionId !== 'string') return this.sendError(client, '未知行动');
    if (!this.isActionUnlocked(player, payload.actionId)) return this.sendError(client, '当前形态未解锁该行动');
    const action: SubmittedAction = {
      actionId: payload.actionId,
      targetId: typeof payload.targetId === 'string' ? payload.targetId : undefined,
    };
    try {
      validateAction(this.toCombatPlayer(player), action, this.combatPlayers());
    } catch (reason) {
      return this.sendError(client, reason instanceof Error ? reason.message : '行动无效');
    }
    if (!this.actions.submit(client.sessionId, action)) return this.sendError(client, '请先撤销已经确认的行动');
    player.submitted = true;
    if (this.actions.allSubmitted(Array.from(this.state.players.values()).filter((candidate) => candidate.alive).map((candidate) => candidate.playerId))) {
      this.resolveCurrentRound();
    }
  }

  private cancelAction(client: Client): void {
    if (this.state.phase !== 'choosing') return this.sendError(client, '当前不能撤销行动');
    const player = this.state.players.get(client.sessionId);
    if (!player?.alive || !player.submitted || !this.actions.has(client.sessionId)) {
      return this.sendError(client, '没有可撤销的行动');
    }
    this.actions.cancel(client.sessionId);
    player.submitted = false;
  }

  private resolveCurrentRound(): void {
    const combatPlayers = this.combatPlayers();
    const result = resolveRound(combatPlayers, this.actions.asReadonlyMap());
    for (const [playerId, combatPlayer] of combatPlayers) {
      const synced = this.state.players.get(playerId);
      if (!synced) continue;
      synced.currentHp = combatPlayer.currentHp;
      synced.alive = combatPlayer.alive;
      synced.submitted = false;
      for (const [resourceId, current] of Object.entries(combatPlayer.resources)) {
        const resource = synced.resources.get(resourceId);
        if (resource) resource.current = Math.max(0, current);
      }
    }
    this.state.lastResult = result.summary.join('\n');
    this.actions.clear();
    if (this.finishIfDecided()) return;
    this.state.round += 1;
  }

  private finishIfDecided(): boolean {
    const survivors = Array.from(this.state.players.values()).filter((player) => player.alive);
    if (survivors.length > 1) return false;
    this.state.phase = 'finished';
    this.state.lastResult += survivors.length === 1
      ? `\n${survivors[0].nickname} 获胜！`
      : '\n无人存活，本局平局。';
    return true;
  }

  private isActionUnlocked(player: PlayerState, actionId: string): boolean {
    const character = characterById.get(player.characterId);
    const form = character?.forms.find((candidate) => candidate.id === player.currentFormId);
    return form?.unlockedActions.includes(actionId) === true;
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
      resources: Object.fromEntries(Array.from(player.resources.entries(), ([id, resource]) => [id, resource.current])),
    };
  }

  private sendError(client: Client, message: string): void {
    client.send('game_error', { message });
  }
}
