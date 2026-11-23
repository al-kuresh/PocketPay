import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import path from 'node:path';
import { ConsoleOtpProvider, type OtpProvider } from './lib/otp';
import { LOCAL_UPLOADS_DIR } from './lib/storage/local';
import { createAuthRouter } from './modules/auth/auth.routes';
import { healthRouter } from './modules/health/health.routes';
import { notFound } from './middlewares/notFound';
import { errorHandler } from './middlewares/errorHandler';

/** Swappable infrastructure, so tests can run without SMS (and later Cloudinary). */
export interface AppDeps {
  otpProvider?: OtpProvider;
}

export function createApp(deps: AppDeps = {}): Express {
  const otpProvider = deps.otpProvider ?? new ConsoleOtpProvider();

  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(pinoHttp());

  // Profile photos from LocalStorage (dev). Only public/ is served; KYC images live in private/.
  app.use('/uploads', express.static(path.resolve(LOCAL_UPLOADS_DIR, 'public')));

  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', createAuthRouter({ otpProvider }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
