import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { experienceRequiredForLevel, PROFILE_NAMEPLATES, PROFILE_TITLES, type GameRatingResultMessage, type GameScoreBreakdown, type PlayerProfile, type ProfileUpdateRequest, type RankId } from '@energy-duel/shared';
import { calculateRating, retainRatingScores, type StoredRatingScore } from '../game/RatingCalculator.js';

interface StoredProfile {
  nickname: string;
  avatarVersion?: number;
  nameplateId: string;
  titleId: string;
  rankId: RankId;
  experience: number;
  rating: number;
  ratingScores: StoredRatingScore[];
  unlockedNameplateIds: string[];
  unlockedTitleIds: string[];
  stats: PlayerProfile['stats'];
}

export interface AccountRecord {
  accountId: string;
  username: string;
  normalizedUsername: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  profile: StoredProfile;
}

interface AccountDatabase { version: 2; accounts: AccountRecord[] }
interface SessionRecord { accountId: string; username: string; expiresAt: number }
export interface SessionResult { accountId: string; username: string; token: string }
export interface SessionIdentity { accountId: string; username: string }

export const USERNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff]{3,16}$/;
export const NICKNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff]{1,16}$/;
export const MIN_PASSWORD_LENGTH = 7;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALL_NAMEPLATE_IDS = PROFILE_NAMEPLATES.map((item) => item.id);

export class SessionService {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly databasePath: string, private readonly now: () => number = Date.now, private readonly ttlMs = SESSION_TTL_MS) {
    this.ensureDatabase();
  }

  register(rawUsername: string, rawPassword: string): SessionResult {
    const username = validateUsername(rawUsername); const password = validatePassword(rawPassword);
    const normalizedUsername = username.toLocaleLowerCase('en-US'); const database = this.readDatabase();
    if (database.accounts.some((candidate) => candidate.normalizedUsername === normalizedUsername)) throw new Error('用户名已被注册');
    const passwordSalt = randomBytes(16).toString('hex');
    const account: AccountRecord = {
      accountId: randomUUID(), username, normalizedUsername, passwordSalt,
      passwordHash: hashPassword(password, passwordSalt), createdAt: new Date(this.now()).toISOString(),
      profile: createDefaultProfile(username),
    };
    database.accounts.push(account); this.writeDatabase(database); return this.issueSession(account);
  }

  login(rawUsername: string, rawPassword: string): SessionResult {
    const username = validateUsername(rawUsername); const password = validatePassword(rawPassword);
    const account = this.readDatabase().accounts.find((candidate) => candidate.normalizedUsername === username.toLocaleLowerCase('en-US'));
    if (!account || !passwordMatches(password, account.passwordSalt, account.passwordHash)) throw new Error('用户名或密码错误');
    return this.issueSession(account);
  }

  validateToken(token: string | undefined): SessionIdentity | null {
    if (!token) return null; const session = this.sessions.get(token); if (!session) return null;
    if (session.expiresAt <= this.now()) { this.sessions.delete(token); return null; }
    return { accountId: session.accountId, username: session.username };
  }

  getProfile(identity: SessionIdentity): PlayerProfile {
    const account = this.findAccount(identity.accountId); return toPublicProfile(account);
  }

  getProfileByAccountId(accountId: string): PlayerProfile {
    return toPublicProfile(this.findAccount(accountId));
  }

  updateProfile(identity: SessionIdentity, update: ProfileUpdateRequest): PlayerProfile {
    const database = this.readDatabase(); const account = database.accounts.find((candidate) => candidate.accountId === identity.accountId);
    if (!account) throw new Error('账号不存在');
    if (update.nickname !== undefined) account.profile.nickname = validateNickname(update.nickname);
    if (update.nameplateId !== undefined) {
      if (!PROFILE_NAMEPLATES.some((item) => item.id === update.nameplateId)) throw new Error('姓名框不存在');
      account.profile.nameplateId = update.nameplateId;
    }
    if (update.titleId !== undefined) {
      if (!account.profile.unlockedTitleIds.includes(update.titleId) || !PROFILE_TITLES.some((item) => item.id === update.titleId)) throw new Error('称号尚未解锁');
      account.profile.titleId = update.titleId;
    }
    this.writeDatabase(database); return toPublicProfile(account);
  }

  markAvatarUpdated(identity: SessionIdentity): PlayerProfile {
    const database = this.readDatabase(); const account = database.accounts.find((candidate) => candidate.accountId === identity.accountId);
    if (!account) throw new Error('账号不存在'); account.profile.avatarVersion = this.now(); this.writeDatabase(database); return toPublicProfile(account);
  }

  recordGameResults(results: readonly { accountId: string; outcome: 'win' | 'loss' | 'draw'; gameId: string; breakdown: GameScoreBreakdown }[]): Map<string, GameRatingResultMessage> {
    const database = this.readDatabase();
    const updates = new Map<string, GameRatingResultMessage>(); const playedAt = new Date(this.now()).toISOString();
    for (const result of results) {
      const account = database.accounts.find((candidate) => candidate.accountId === result.accountId); if (!account) continue;
      if (account.profile.ratingScores.some((score) => score.gameId === result.gameId)) continue;
      const previousRating = calculateRating(account.profile.ratingScores).rating;
      account.profile.ratingScores.push({ gameId: result.gameId, score: result.breakdown.totalScore, formulaVersion: result.breakdown.formulaVersion, playedAt });
      account.profile.ratingScores = retainRatingScores(account.profile.ratingScores);
      const rating = calculateRating(account.profile.ratingScores); account.profile.rating = rating.rating;
      const stats = account.profile.stats; stats.totalGames += 1;
      if (result.outcome === 'win') { stats.wins += 1; stats.currentWinStreak += 1; stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.currentWinStreak); account.profile.experience += 200; }
      else if (result.outcome === 'draw') { stats.draws += 1; stats.currentWinStreak = 0; account.profile.experience += 150; }
      else { stats.losses += 1; stats.currentWinStreak = 0; account.profile.experience += 100; }
      updates.set(result.accountId, { breakdown: result.breakdown, previousRating, rating: rating.rating, best35Contribution: rating.best35Contribution, recent15Contribution: rating.recent15Contribution });
    }
    this.writeDatabase(database);
    return updates;
  }

  private issueSession(account: AccountRecord): SessionResult {
    const token = randomBytes(32).toString('hex'); this.sessions.set(token, { accountId: account.accountId, username: account.username, expiresAt: this.now() + this.ttlMs });
    return { accountId: account.accountId, username: account.username, token };
  }
  private findAccount(accountId: string): AccountRecord { const account = this.readDatabase().accounts.find((candidate) => candidate.accountId === accountId); if (!account) throw new Error('账号不存在'); return account; }
  private ensureDatabase(): void { const directory = path.dirname(this.databasePath); if (!existsSync(directory)) mkdirSync(directory, { recursive: true }); if (!existsSync(this.databasePath)) this.writeDatabase({ version: 2, accounts: [] }); }
  private readDatabase(): AccountDatabase { const parsed = JSON.parse(readFileSync(this.databasePath, 'utf8')) as Partial<AccountDatabase>; if (parsed.version !== 2 || !Array.isArray(parsed.accounts)) throw new Error('账号数据版本不兼容，请清理旧数据后重启服务'); for (const account of parsed.accounts) account.profile.ratingScores ??= []; return parsed as AccountDatabase; }
  private writeDatabase(database: AccountDatabase): void { const temporaryPath = `${this.databasePath}.tmp`; writeFileSync(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8'); renameSync(temporaryPath, this.databasePath); }
}

function createDefaultProfile(username: string): StoredProfile { return { nickname: username, nameplateId: 'standard', titleId: 'novice', rankId: 'unranked', experience: 0, rating: 0, ratingScores: [], unlockedNameplateIds: [...ALL_NAMEPLATE_IDS], unlockedTitleIds: ['novice'], stats: { totalGames: 0, wins: 0, losses: 0, draws: 0, currentWinStreak: 0, bestWinStreak: 0 } }; }
function toPublicProfile(account: AccountRecord): PlayerProfile {
  let level = 1; while (level < 999 && account.profile.experience >= experienceRequiredForLevel(level + 1)) level += 1;
  const rating = calculateRating(account.profile.ratingScores);
  return { accountId: account.accountId, username: account.username, nickname: account.profile.nickname, avatarUrl: account.profile.avatarVersion ? `/api/avatars/${account.accountId}?v=${account.profile.avatarVersion}` : undefined, nameplateId: account.profile.nameplateId, titleId: account.profile.titleId, rankId: account.profile.rankId, level, experience: account.profile.experience, experienceForNextLevel: experienceRequiredForLevel(level + 1), rating: rating.rating, ratingBest35: rating.best35Contribution, ratingRecent15: rating.recent15Contribution, lastGameScore: account.profile.ratingScores.at(-1)?.score, unlockedNameplateIds: [...ALL_NAMEPLATE_IDS], unlockedTitleIds: [...account.profile.unlockedTitleIds], stats: { ...account.profile.stats }, createdAt: account.createdAt };
}
function hashPassword(password: string, salt: string): string { return scryptSync(password, salt, 64).toString('hex'); }
function passwordMatches(password: string, salt: string, expected: string): boolean { const actual = Buffer.from(hashPassword(password, salt), 'hex'); const stored = Buffer.from(expected, 'hex'); return actual.length === stored.length && timingSafeEqual(actual, stored); }
export function validateUsername(raw: string): string { const value = raw.trim(); if (!USERNAME_PATTERN.test(value)) throw new Error('用户名需为 3–16 个中文、字母、数字或下划线'); return value; }
export function validateNickname(raw: string): string { const value = raw.trim(); if (!NICKNAME_PATTERN.test(value)) throw new Error('昵称需为 1–16 个中文、字母、数字或下划线'); return value; }
export function validatePassword(raw: string): string { if (typeof raw !== 'string' || raw.length < MIN_PASSWORD_LENGTH) throw new Error('密码至少需要 7 个字符'); if (raw.length > 128) throw new Error('密码不能超过 128 个字符'); return raw; }
