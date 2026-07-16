import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionService, validatePassword, validateUsername } from './SessionService.js';

const directories: string[] = [];
function createService(now: () => number = Date.now, ttlMs?: number): SessionService { const directory = mkdtempSync(path.join(tmpdir(), 'energy-duel-')); directories.push(directory); return new SessionService(path.join(directory, 'users.json'), now, ttlMs); }
afterEach(() => { while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true }); });

describe('SessionService password accounts', () => {
  it('validates usernames and passwords', () => {
    expect(validateUsername('  玩家_01  ')).toBe('玩家_01');
    expect(validatePassword('1234567')).toBe('1234567');
    expect(() => validatePassword('123456')).toThrow(/7/);
  });

  it('registers unique usernames and logs in case-insensitively', () => {
    const service = createService(); const registered = service.register('Player_One', 'password1');
    expect(service.login('player_one', 'password1').accountId).toBe(registered.accountId);
    expect(() => service.register('PLAYER_ONE', 'password2')).toThrow(/已被注册/);
    expect(() => service.login('player_one', 'wrong-pass')).toThrow(/用户名或密码错误/);
  });

  it('persists salted hashes instead of plaintext passwords', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'energy-duel-')); directories.push(directory); const databasePath = path.join(directory, 'users.json');
    const service = new SessionService(databasePath); service.register('测试玩家', 'secret777'); const contents = readFileSync(databasePath, 'utf8');
    expect(contents).toContain('passwordHash'); expect(contents).toContain('passwordSalt'); expect(contents).not.toContain('secret777');
  });

  it('creates a default profile and enforces cosmetic unlocks', () => {
    const service = createService(); const session = service.register('ProfileOne', 'password1'); const identity = service.validateToken(session.token)!;
    expect(service.getProfile(identity)).toMatchObject({ nickname: 'ProfileOne', level: 1, rating: 0, rankId: 'unranked', nameplateId: 'standard', titleId: 'novice' });
    expect(service.updateProfile(identity, { nickname: '新昵称' }).nickname).toBe('新昵称');
    expect(() => service.updateProfile(identity, { titleId: 'survivor' })).toThrow(/尚未解锁/);
    expect(service.getProfileByAccountId(session.accountId).username).toBe('ProfileOne');
  });

  it('rejects unknown and expired tokens', () => {
    let now = 1000; const service = createService(() => now, 100); const session = service.register('Player_2', 'password1');
    expect(service.validateToken('missing')).toBeNull(); expect(service.validateToken(session.token)?.accountId).toBe(session.accountId); now = 1100; expect(service.validateToken(session.token)).toBeNull();
  });

  it('awards experience and career results for completed games', () => {
    const service = createService(); const winner = service.register('WinnerOne', 'password1'); const loser = service.register('LoserOne', 'password1');
    const winnerBreakdown = { formulaVersion: 1, resultScore: 180, survivalScore: 40, offenseScore: 12, defenseScore: 0, participationScore: 4, totalScore: 236 };
    const loserBreakdown = { formulaVersion: 1, resultScore: 60, survivalScore: 20, offenseScore: 0, defenseScore: 6, participationScore: 2, totalScore: 88 };
    service.recordGameResults([{ accountId: winner.accountId, outcome: 'win', gameId: 'game-1', breakdown: winnerBreakdown }, { accountId: loser.accountId, outcome: 'loss', gameId: 'game-1', breakdown: loserBreakdown }]);
    expect(service.getProfile(service.validateToken(winner.token)!)).toMatchObject({ experience: 200, rating: 472, ratingBest35: 236, ratingRecent15: 236, lastGameScore: 236, stats: { totalGames: 1, wins: 1, currentWinStreak: 1 } });
    expect(service.getProfile(service.validateToken(loser.token)!)).toMatchObject({ experience: 100, rating: 176, stats: { totalGames: 1, losses: 1, currentWinStreak: 0 } });
  });
});
