import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineRoom, defineServer } from 'colyseus';
import express from 'express';
import { EnergyDuelRoom } from './rooms/EnergyDuelRoom.js';
import { sessionService } from './services.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(directory, '../../client/dist');

const server = defineServer({
  rooms: {
    energy_duel_demo: defineRoom(EnergyDuelRoom),
  },
  express: (app) => {
    app.set('trust proxy', 1);
    app.use(express.json({ limit: '32kb' }));
    app.use((_request, response, next) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (_request.method === 'OPTIONS') return response.sendStatus(204);
      next();
    });

    app.get('/api/health', (_request, response) => {
      response.json({
        status: 'ok',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    });

    app.post('/api/session', (request, response) => {
      try {
        const username = typeof request.body?.username === 'string' ? request.body.username : '';
        response.json(sessionService.createSession(username));
      } catch (reason) {
        response.status(400).json({ error: reason instanceof Error ? reason.message : '用户名无效' });
      }
    });

    if (existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get('/', (_request, response) => response.sendFile(path.join(clientDist, 'index.html')));
    }
  },
});

export default server;
