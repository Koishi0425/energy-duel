import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import express from 'express';
import { EnergyDuelRoom } from './rooms/EnergyDuelRoom.js';
import { summarizeJoinableRooms } from './rooms/roomDirectory.js';
import { sessionService } from './services.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(directory, '../../client/dist');
const avatarDirectory = path.resolve(directory, '../data/avatars');

const server = defineServer({
  rooms: {
    energy_duel_demo: defineRoom(EnergyDuelRoom),
  },
  express: (app) => {
    app.set('trust proxy', 1);
    app.use(express.json({ limit: '2mb' }));
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

    app.get('/api/rooms', async (_request, response) => {
      try {
        const listings = await matchMaker.driver.query({ name: 'energy_duel_demo' });
        response.setHeader('Cache-Control', 'no-store');
        response.json({
          rooms: summarizeJoinableRooms(listings),
          generatedAt: new Date().toISOString(),
        });
      } catch {
        response.status(503).json({ error: '暂时无法读取房间列表' });
      }
    });

    app.post('/api/auth/register', (request, response) => {
      try {
        const username = typeof request.body?.username === 'string' ? request.body.username : '';
        const password = typeof request.body?.password === 'string' ? request.body.password : '';
        response.status(201).json(sessionService.register(username, password));
      } catch (reason) {
        response.status(400).json({ error: reason instanceof Error ? reason.message : '注册失败' });
      }
    });

    app.post('/api/auth/login', (request, response) => {
      try {
        const username = typeof request.body?.username === 'string' ? request.body.username : '';
        const password = typeof request.body?.password === 'string' ? request.body.password : '';
        response.json(sessionService.login(username, password));
      } catch (reason) { response.status(401).json({ error: reason instanceof Error ? reason.message : '登录失败' }); }
    });

    app.get('/api/profile', (request, response) => {
      const identity = authenticatedIdentity(request.headers.authorization);
      if (!identity) return response.status(401).json({ error: '会话无效或已过期' });
      try { response.json(sessionService.getProfile(identity)); }
      catch (reason) { response.status(404).json({ error: reason instanceof Error ? reason.message : '资料不存在' }); }
    });

    app.patch('/api/profile', (request, response) => {
      const identity = authenticatedIdentity(request.headers.authorization);
      if (!identity) return response.status(401).json({ error: '会话无效或已过期' });
      try { response.json(sessionService.updateProfile(identity, request.body ?? {})); }
      catch (reason) { response.status(400).json({ error: reason instanceof Error ? reason.message : '资料更新失败' }); }
    });

    app.put('/api/profile/avatar', (request, response) => {
      const identity = authenticatedIdentity(request.headers.authorization);
      if (!identity) return response.status(401).json({ error: '会话无效或已过期' });
      try {
        const dataUrl = typeof request.body?.avatarDataUrl === 'string' ? request.body.avatarDataUrl : '';
        const match = /^data:image\/webp;base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
        if (!match) throw new Error('头像必须是裁剪后的 WebP 图片');
        const contents = Buffer.from(match[1], 'base64');
        if (contents.length < 12 || contents.length > 1024 * 1024 || contents.subarray(0, 4).toString('ascii') !== 'RIFF' || contents.subarray(8, 12).toString('ascii') !== 'WEBP') throw new Error('头像文件无效或超过 1MB');
        if (!existsSync(avatarDirectory)) mkdirSync(avatarDirectory, { recursive: true });
        writeFileSync(path.join(avatarDirectory, `${identity.accountId}.webp`), contents);
        response.json(sessionService.markAvatarUpdated(identity));
      } catch (reason) { response.status(400).json({ error: reason instanceof Error ? reason.message : '头像保存失败' }); }
    });

    app.get('/api/avatars/:accountId', (request, response) => {
      const accountId = typeof request.params.accountId === 'string' && /^[0-9a-f-]{36}$/i.test(request.params.accountId) ? request.params.accountId : '';
      const avatarPath = path.join(avatarDirectory, `${accountId}.webp`);
      if (!accountId || !existsSync(avatarPath)) return response.sendStatus(404);
      response.setHeader('Content-Type', 'image/webp'); response.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); response.send(readFileSync(avatarPath));
    });

    if (existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get('/', (_request, response) => response.sendFile(path.join(clientDist, 'index.html')));
    }
  },
});

function authenticatedIdentity(authorization: string | undefined) {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  return sessionService.validateToken(token);
}

export default server;
