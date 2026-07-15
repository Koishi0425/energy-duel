export interface SessionResponse {
  accountId: string;
  username: string;
  token: string;
}

export interface SessionIdentity {
  accountId: string;
  username: string;
}

export interface PublicRoomSummary {
  roomId: string;
  hostNickname: string;
  clients: number;
  maxClients: number;
  createdAt: string;
}

export interface PublicRoomListResponse {
  rooms: PublicRoomSummary[];
  generatedAt: string;
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
  resultConfirmed: boolean;
}

export type GamePhase = 'waiting' | 'choosing' | 'deferred' | 'resolving' | 'finished';
export type ActionCategory = 'base' | 'attack' | 'defense' | 'resource' | 'special';
export type TargetMode = 'none' | 'single_enemy' | 'multiple_enemies' | 'all_enemies';
export type ActionId = string;

export interface SyncedGameState {
  phase: GamePhase;
  round: number;
  gameNumber: number;
  hostPlayerId: string;
  lastResult: string;
}

export interface SyncedRoundLogEntry {
  gameNumber: number;
  round: number;
  time: string;
  text: string;
}

export interface SubmitActionMessage {
  actionId: ActionId;
  targetId?: string;
  targetIds?: string[];
  transformCharacterId?: string;
  power?: number;
  requestId?: string;
}

export interface SubmitDeferredTargetsMessage {
  targetIds: string[];
  requestId?: string;
}

export interface RevealedAction {
  playerId: string;
  actionId: string;
  power?: number;
}

export interface DeferredActionRequiredMessage {
  actionId: string;
  power: number;
  allocationCount: number;
  revealedActions: RevealedAction[];
}

export interface ResolutionActor {
  playerId: string;
  targetIds: string[];
  actionId: string;
  poseId?: string;
  transformCharacterId?: string;
  power?: number;
}

export interface ResolutionStep {
  sequence: number;
  speedPriority: number;
  actors: ResolutionActor[];
  participantIds: string[];
  durationMs: number;
}

export interface RoundResolutionMessage {
  round: number;
  steps: ResolutionStep[];
  totalDurationMs: number;
}

export interface CommandResultMessage {
  requestId?: string;
  command: string;
  ok: boolean;
  message: string;
}
