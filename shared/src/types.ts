export interface SessionResponse {
  accountId: string;
  username: string;
  token: string;
}

export interface SessionIdentity {
  accountId: string;
  username: string;
}

export interface SyncedResource {
  resourceId: string;
  current: number;
  max: number;
}

export interface SyncedBuff {
  instanceId: string;
  buffId: string;
  stacks: number;
  remainingTurns: number;
  sourcePlayerId: string;
}

export interface SyncedPlayer {
  playerId: string;
  accountId: string;
  username: string;
  nickname: string;
  gridIndex: number;
  color: number;
  ready: boolean;
  alive: boolean;
  currentHp: number;
  maxHp: number;
  characterId: string;
  currentFormId: string;
  resources: Record<string, SyncedResource>;
  buffs: SyncedBuff[];
  submitted: boolean;
  connected: boolean;
}

export type GamePhase = 'waiting' | 'choosing' | 'finished';
export type ActionCategory = 'attack' | 'defense' | 'special';
export type TargetMode = 'none' | 'single_enemy' | 'all_enemies';
export type ActionId = string;

export interface SyncedGameState {
  phase: GamePhase;
  round: number;
  hostPlayerId: string;
  lastResult: string;
}

export interface SubmitActionMessage {
  actionId: ActionId;
  targetId?: string;
}
