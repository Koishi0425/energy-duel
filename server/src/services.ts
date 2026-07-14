import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionService } from './auth/SessionService.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const sessionService = new SessionService(path.resolve(directory, '../data/users.json'));
