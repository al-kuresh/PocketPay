import type { Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

const MINUTE = 60_000;

// Counts per client IP (req.ip) unless a keyGenerator says otherwise (the money and lookup
// limiters count per user). In production behind a proxy (Render, Railway…), every
// request would come from the proxy's IP unless the app sets app.set('trust proxy', 1)
// so req.ip is the real client: that's Phase 9.
export function createLimiter(opts: {
  windowMs: number;
  limit: number;
  skip?: () => boolean;
  /** Default: the client IP. */
  keyGenerator?: (req: Request) => string;
}) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    keyGenerator: opts.keyGenerator, // undefined → express-rate-limit's own IP key
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

// Per user, not per IP: Bangladeshi mobile networks put many phones behind one IP (CGNAT).
// Only for routes after requireAuth, which sets req.user.
const byUser = (req: Request) => req.user!.id;

/** The 4 money POSTs: 30 per minute per user, one budget shared by all four. */
export const moneyLimiter = createLimiter({ windowMs: MINUTE, limit: 30, keyGenerator: byUser });

/** POST /transactions/preview: 60 per minute per user, its own budget, so fee checks never use up the money POSTs'. */
export const previewLimiter = createLimiter({ windowMs: MINUTE, limit: 60, keyGenerator: byUser });

/** PATCH /auth/pin: 5 per 15 minutes per user (on top of the 3-strike PIN lockout). */
export const pinChangeLimiter = createLimiter({
  windowMs: 15 * MINUTE,
  limit: 5,
  keyGenerator: byUser,
});

/** PUT /me/photo: 10 per 15 minutes per user. Each upload holds up to 10 MB in memory and a sharp decode. */
export const photoUploadLimiter = createLimiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  keyGenerator: byUser,
});

/** POST /kyc/resubmit: 5 per hour per user. Each one holds up to 3 × 10 MB in memory and 4 sharp decodes. */
export const kycResubmitLimiter = createLimiter({ windowMs: 60 * MINUTE, limit: 5, keyGenerator: byUser });

/** Every /admin/* route: 120 per minute per admin, its own budget. */
export const adminLimiter = createLimiter({ windowMs: MINUTE, limit: 120, keyGenerator: byUser });

/** GET /wallets/lookup: 30 per minute per user, to slow down phone-number enumeration. */
export const lookupLimiter = createLimiter({ windowMs: MINUTE, limit: 30, keyGenerator: byUser });
