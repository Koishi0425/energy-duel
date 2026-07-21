import { matchMaker, type Client } from '@colyseus/core';
import type { LobbySnapshotMessage } from '@energy-duel/shared';
import { presenceService } from '../presence.js';
import { summarizeJoinableRooms } from '../rooms/roomDirectory.js';
import { sessionService } from '../services.js';

const PRESENCE_PRUNE_INTERVAL_MS = 15_000;

export class LobbyFeed {
  private readonly clients = new Set<Client>();
  private snapshot: LobbySnapshotMessage | undefined;
  private snapshotPromise: Promise<LobbySnapshotMessage> | undefined;
  private publishQueued = false;
  private publishing = false;
  private publishAgain = false;
  private version = 0;

  constructor() {
    const timer = setInterval(() => {
      if (presenceService.prune()) this.publish();
    }, PRESENCE_PRUNE_INTERVAL_MS);
    timer.unref();
  }

  async subscribe(client: Client): Promise<void> {
    this.clients.add(client);
    try {
      client.send('lobby_snapshot', await this.currentSnapshot());
    } catch {
      this.clients.delete(client);
    }
  }

  unsubscribe(client: Client): void {
    this.clients.delete(client);
  }

  publish(): void {
    if (this.clients.size === 0) {
      this.snapshot = undefined;
      return;
    }
    if (this.publishing) {
      this.publishAgain = true;
      return;
    }
    if (this.publishQueued) return;
    this.publishQueued = true;
    queueMicrotask(() => {
      this.publishQueued = false;
      void this.broadcastSnapshot();
    });
  }

  private async broadcastSnapshot(): Promise<void> {
    if (this.publishing) {
      this.publishAgain = true;
      return;
    }
    this.publishing = true;
    try {
      const snapshot = await this.currentSnapshot(true);
      for (const client of this.clients) {
        try { client.send('lobby_snapshot', snapshot); }
        catch { this.clients.delete(client); }
      }
    } finally {
      this.publishing = false;
      if (this.publishAgain) {
        this.publishAgain = false;
        this.publish();
      }
    }
  }

  private async currentSnapshot(force = false): Promise<LobbySnapshotMessage> {
    if (!force && this.snapshot) return this.snapshot;
    if (this.snapshotPromise) {
      if (!force) return this.snapshotPromise;
      await this.snapshotPromise;
    }
    this.snapshotPromise = this.createSnapshot().finally(() => { this.snapshotPromise = undefined; });
    return this.snapshotPromise;
  }

  private async createSnapshot(): Promise<LobbySnapshotMessage> {
    const listings = await matchMaker.driver.query({ name: 'energy_duel_demo' });
    const snapshot: LobbySnapshotMessage = {
      version: ++this.version,
      rooms: summarizeJoinableRooms(listings),
      players: presenceService.list(sessionService),
      generatedAt: new Date().toISOString(),
    };
    this.snapshot = snapshot;
    return snapshot;
  }
}

export const lobbyFeed = new LobbyFeed();
