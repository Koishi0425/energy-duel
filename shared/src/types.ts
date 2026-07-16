import rawProfileAssets from '../config/profile-assets.json' with { type: 'json' };

export interface SessionResponse {
  accountId: string;
  username: string;
  token: string;
}

export type RankId = 'unranked' | 'iron' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'emerald' | 'diamond' | 'master' | 'grandmaster' | 'challenger';

export interface CareerStats {
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  currentWinStreak: number;
  bestWinStreak: number;
}

export interface PlayerProfile {
  accountId: string;
  username: string;
  nickname: string;
  avatarUrl?: string;
  nameplateId: string;
  titleId: string;
  rankId: RankId;
  level: number;
  experience: number;
  experienceForNextLevel: number;
  rating: number;
  ratingBest35: number;
  ratingRecent15: number;
  lastGameScore?: number;
  unlockedNameplateIds: string[];
  unlockedTitleIds: string[];
  stats: CareerStats;
  createdAt: string;
}

export interface GameScoreBreakdown {
  formulaVersion: number;
  resultScore: number;
  survivalScore: number;
  offenseScore: number;
  defenseScore: number;
  participationScore: number;
  totalScore: number;
}

export interface GameRatingResultMessage {
  breakdown: GameScoreBreakdown;
  previousRating: number;
  rating: number;
  best35Contribution: number;
  recent15Contribution: number;
}

export interface ProfileUpdateRequest {
  nickname?: string;
  nameplateId?: string;
  titleId?: string;
  avatarDataUrl?: string;
}

export interface ProfileCosmeticDefinition {
  id: string;
  name: string;
  description: string;
  assetUrl?: string;
  previewUrl?: string;
  rarity?: ProfileTitleRarity;
}

export type ProfileTitleRarity = 'normal' | 'bronze' | 'silver' | 'gold' | 'rainbow';

export interface ProfileTitleRarityDefinition {
  id: ProfileTitleRarity;
  name: string;
  assetUrl: string;
}

export const PROFILE_TITLE_RARITIES: Readonly<Record<ProfileTitleRarity, ProfileTitleRarityDefinition>> = {
  normal: { id: 'normal', ...rawProfileAssets.titleRarities.normal },
  bronze: { id: 'bronze', ...rawProfileAssets.titleRarities.bronze },
  silver: { id: 'silver', ...rawProfileAssets.titleRarities.silver },
  gold: { id: 'gold', ...rawProfileAssets.titleRarities.gold },
  rainbow: { id: 'rainbow', ...rawProfileAssets.titleRarities.rainbow },
};

export const PROFILE_NAMEPLATES: readonly ProfileCosmeticDefinition[] = [
  { id: 'standard', name: '标准竞技框', description: '所有玩家默认拥有。' },
  { id: 'veteran', name: '久经沙场', description: '成就奖励，尚未开放。' },
  ...rawProfileAssets.nameplates,
];

export const PROFILE_TITLES: readonly ProfileCosmeticDefinition[] = [
  { id: 'novice', name: '初心者', description: '所有玩家默认拥有。', rarity: 'normal' },
  { id: 'survivor', name: '绝境生还', description: '通过濒死翻盘成就解锁。', rarity: 'bronze' },
];

export type ProfileLevelTier = 'normal' | 'purple-bronze' | 'brass' | 'platinum' | 'rainbow' | 'diamond';

export function profileLevelTier(level: number): ProfileLevelTier {
  const normalized = Math.max(1, Math.floor(level));
  if (normalized >= 999) return 'diamond';
  if (normalized >= 500) return 'rainbow';
  if (normalized >= 100) return 'platinum';
  if (normalized >= 30) return 'brass';
  if (normalized >= 10) return 'purple-bronze';
  return 'normal';
}

export function experienceRequiredForLevel(level: number): number {
  const normalized = Math.max(1, Math.floor(level));
  const n = normalized - 1;
  return 100 * n * n + 300 * n;
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
  controllerPlayerId: string;
  isTrainingDummy: boolean;
}

export type GamePhase = 'waiting' | 'choosing' | 'deferred' | 'resolving' | 'finished';
export type RoomMode = 'standard' | 'training';
export type ActionCategory = 'base' | 'attack' | 'defense' | 'resource' | 'special';
export type TargetMode = 'none' | 'single_enemy' | 'multiple_enemies' | 'all_enemies';
export type ActionId = string;

export interface SyncedGameState {
  phase: GamePhase;
  round: number;
  gameNumber: number;
  hostPlayerId: string;
  lastResult: string;
  roomMode: RoomMode;
}

export interface SyncedRoundLogEntry {
  gameNumber: number;
  round: number;
  time: string;
  text: string;
}

export interface SubmitActionMessage {
  actorPlayerId?: string;
  actionId: ActionId;
  targetId?: string;
  targetIds?: string[];
  transformCharacterId?: string;
  power?: number;
  targetGridIndex?: number;
  resourceSpend?: Record<string, number>;
  requestId?: string;
}

export interface SubmitDeferredTargetsMessage {
  actorPlayerId?: string;
  targetIds: string[];
  requestId?: string;
}

export interface RevealedAction {
  playerId: string;
  actionId: string;
  power?: number;
}

export interface DeferredActionRequiredMessage {
  actorPlayerId: string;
  actionId: string;
  power: number;
  allocationCount: number;
  revealedActions: RevealedAction[];
  allowSkip?: boolean;
}

export interface ConfigureTrainingActorMessage {
  actorPlayerId: string;
  nickname?: string;
  characterId?: string;
  resources?: Record<string, number>;
  requestId?: string;
}

export interface ResolutionActor {
  playerId: string;
  targetIds: string[];
  actionId: string;
  poseId?: string;
  transformCharacterId?: string;
  power?: number;
  targetGridIndex?: number;
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
