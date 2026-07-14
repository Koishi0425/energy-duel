import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionService, validateUsername } from './SessionService.js';

const directories: string[] = [];

function createService(now: () => number = Date.now, ttlMs?: number): SessionService {
  const directory = mkdtempSync(path.join(tmpdir(), 'energy-duel-'));
  directories.push(directory);
  return new SessionService(path.join(directory, 'users.json'), now, ttlMs);
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('SessionService', () => {
  it('validates and trims usernames', () => {
    expect(validateUsername('  玩家_01  ')).toBe('玩家_01');
    expect(() => validateUsername('ab')).toThrow(/3–16/);
    expect(() => validateUsername('bad name')).toThrow(/3–16/);
  });

  it('reuses an account for case-insensitive username login', () => {
    const service = createService();
    const first = service.createSession('Player_One');
    const second = service.createSession('player_one');
    expect(second.accountId).toBe(first.accountId);
    expect(second.username).toBe('Player_One');
  });

  it('persists account mappings without passwords', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'energy-duel-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'users.json');
    const service = new SessionService(databasePath);
    service.createSession('测试玩家');
    const contents = readFileSync(databasePath, 'utf8');
    expect(contents).toContain('测试玩家');
    expect(contents).not.toContain('password');
  });

  it('rejects unknown and expired tokens', () => {
    let now = 1000;
    const service = createService(() => now, 100);
    const session = service.createSession('Player_2');
    expect(service.validateToken('missing')).toBeNull();
    expect(service.validateToken(session.token)?.accountId).toBe(session.accountId);
    now = 1100;
    expect(service.validateToken(session.token)).toBeNull();
  });
});
