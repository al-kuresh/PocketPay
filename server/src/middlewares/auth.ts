import type { Request, RequestHandler } from 'express';
import type { Role } from '../generated/prisma/enums';
import { verifyAccessToken } from '../modules/auth/tokens';
import { AppError } from '../utils/AppError';

/** The token from `Authorization: Bearer <token>`, or '' (which every verifier rejects). */
export const bearerToken = (req: Request): string =>
  /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1] ?? '';

/** Verifies the access token and sets req.user. Missing or invalid → 401 UNAUTHENTICATED. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const { userId, role } = verifyAccessToken(bearerToken(req));
  req.user = { id: userId, role };
  next();
};

/** Use after requireAuth. A role outside `roles` → 403 FORBIDDEN. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Please log in again'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have access to this'));
      return;
    }
    next();
  };
