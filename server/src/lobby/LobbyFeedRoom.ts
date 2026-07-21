import { Client, Room, ServerError } from '@colyseus/core';
import type { SessionIdentity } from '@energy-duel/shared';
import { sessionService } from '../services.js';
import { lobbyFeed } from './LobbyFeed.js';

export class LobbyFeedRoom extends Room {
  maxClients = 1000;

  onCreate(): void {
    this.onMessage('request_snapshot', (client) => {
      void lobbyFeed.subscribe(client);
    });
  }

  onAuth(client: Client): SessionIdentity {
    const token = client.auth?.token;
    const identity = sessionService.validateToken(token);
    if (!identity) throw new ServerError(401, '会话无效或已过期');
    return identity;
  }

  onJoin(client: Client): void {
    void lobbyFeed.subscribe(client);
  }

  onLeave(client: Client): void {
    lobbyFeed.unsubscribe(client);
  }
}
