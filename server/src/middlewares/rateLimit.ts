import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

const MINUTE = 60_000;

// Counts per client IP (req.ip). In production behind a proxy (Render, Railway…), every
// request would come from the proxy's IP unless the app sets app.set('trust proxy', 1)
// so req.ip is the real client: that's Phase 9.
export function createLimiter(opts: { windowMs: number; limit: number; skip?: () => boolean }) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: opts.skip ?? (() => env.NODE_ENV === 'test'),
    // Through errorHandler, so the 429 has the same { success: false, error } shape as the rest.
    handler: (_req, _res, next) => {
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later'));
    },
  });
}

/** POST /auth/register/request-otp: 5 per 15 minutes per IP (each one may send an SMS). */
export const otpLimiter = createLimiter({ windowMs: 15 * MINUTE, limit: 5 });

/** POST /auth/login: 10 per 15 minutes per IP (on top of the 3-strike PIN lockout). */
export const loginLimiter = createLimiter({ windowMs: 15 * MINUTE, limit: 10 });

/** The 4 money POSTs and preview: 30 per minute per IP, one budget shared by all five. */
export const moneyLimiter = createLimiter({ windowMs: MINUTE, limit: 30 });

/** GET /wallets/lookup: 30 per minute per IP, to slow down phone-number enumeration. */
export const lookupLimiter = createLimiter({ windowMs: MINUTE, limit: 30 });
