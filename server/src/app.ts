import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import path from 'node:path';
import { httpLogger } from './lib/httpLogger';
import { logger } from './lib/logger';
import { ConsoleOtpProvider, type OtpProvider } from './lib/otp';
import { createStorage, type StorageProvider } from './lib/storage';
import { LOCAL_UPLOADS_DIR } from './lib/storage/local';
import { createAuthRouter } from './modules/auth/auth.routes';
import { healthRouter } from './modules/health/health.routes';
import { createMeRouter } from './modules/me/me.routes';
import { transactionsRouter } from './modules/transactions/transactions.routes';
import { walletsRouter } from './modules/wallets/wallets.routes';
import { notFound } from './middlewares/notFound';
import { errorHandler } from './middlewares/errorHandler';

/** Swappable infrastructure, so tests can run without SMS or Cloudinary. */
export interface AppDeps {
  otpProvider?: OtpProvider;
  storage?: StorageProvider;
  kycAutoApprove?: boolean;
}

export function createApp(deps: AppDeps = {}): Express {
  const authDeps = {
    otpProvider: deps.otpProvider ?? new ConsoleOtpProvider(),
    storage: deps.storage ?? createStorage(env),
    kycAutoApprove: deps.kycAutoApprove ?? env.KYC_AUTO_APPROVE,
  };

  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(httpLogger(logger));

  // Profile photos from LocalStorage (dev). Only public/ is served; KYC images live in private/.
  app.use('/uploads', express.static(path.resolve(LOCAL_UPLOADS_DIR, 'public')));

  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', createAuthRouter(authDeps));
  app.use('/api/v1/me', createMeRouter({ storage: authDeps.storage }));
  app.use('/api/v1/transactions', transactionsRouter);
  app.use('/api/v1/wallets', walletsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
