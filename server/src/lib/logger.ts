import { pino } from 'pino';
import { env } from '../config/env';

/** The server's one logger. pino-http derives its per-request child logger from it (app.ts). */
export const logger = pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });
