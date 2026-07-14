import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface AccountRecord {
  accountId: string;
  username: string;
  normalizedUsername: string;
  createdAt: string;
}

interface AccountDatabase {
  accounts: AccountRecord[];
}

interface SessionRecord {
  accountId: string;
  username: string;
  expiresAt: number;
}

export interface SessionResult {
  accountId: string;
  username: string;
  token: string;
}

export interface SessionIdentity {
  accountId: string;
  username: string;
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff]{3,16}$/;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class SessionService {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly databasePath: string,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = SESSION_TTL_MS,
  ) {
    this.ensureDatabase();
  }

  createSession(rawUsername: string): SessionResult {
    const username = validateUsername(rawUsername);
    const normalizedUsername = username.toLocaleLowerCase('en-US');
    const database = this.readDatabase();
    let account = database.accounts.find((candidate) => candidate.normalizedUsername === normalizedUsername);

    if (!account) {
      account = {
        accountId: randomUUID(),
        username,
        normalizedUsername,
        createdAt: new Date(this.now()).toISOString(),
      };
      database.accounts.push(account);
      this.writeDatabase(database);
    }

    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, {
      accountId: account.accountId,
      username: account.username,
      expiresAt: this.now() + this.ttlMs,
    });
    return { accountId: account.accountId, username: account.username, token };
  }

  validateToken(token: string | undefined): SessionIdentity | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(token);
      return null;
    }
    return { accountId: session.accountId, username: session.username };
  }

  private ensureDatabase(): void {
    const directory = path.dirname(this.databasePath);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    if (!existsSync(this.databasePath)) this.writeDatabase({ accounts: [] });
  }

  private readDatabase(): AccountDatabase {
    const parsed = JSON.parse(readFileSync(this.databasePath, 'utf8')) as Partial<AccountDatabase>;
    if (!Array.isArray(parsed.accounts)) throw new Error('Account database is malformed.');
    return { accounts: parsed.accounts };
  }

  private writeDatabase(database: AccountDatabase): void {
    const temporaryPath = `${this.databasePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
    renameSync(temporaryPath, this.databasePath);
  }
}

export function validateUsername(rawUsername: string): string {
  const username = rawUsername.trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('用户名需为 3–16 个中文、字母、数字或下划线');
  }
  return username;
}
