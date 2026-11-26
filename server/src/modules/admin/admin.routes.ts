import { type Request, type RequestHandler, Router } from 'express';
import type { StorageProvider } from '../../lib/storage';
import { requireAuth, requireRole } from '../../middlewares/auth';
import { adminLimiter } from '../../middlewares/rateLimit';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validate';
import {
  type AuditListQuery,
  type KycListQuery,
  type UsersListQuery,
  auditListQuery,
  idParams,
  kycListQuery,
  kycReviewBody,
  userStatusBody,
  usersListQuery,
} from './admin.schemas';
import type { Actor } from './admin.shared';
import { listAudit } from './audit.service';
import { getKyc, listKyc, reviewKyc } from './kyc.service';
import { changeUserStatus, getUser, listUsers, unlockUser } from './users.service';

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

const actor = (req: Request): Actor => ({ id: req.user!.id, ip: req.ip });
const idOf = (res: { locals: Record<string, unknown> }) => (res.locals.params as { id: string }).id;

/**
 * /api/v1/admin/*: admins only, 120 requests a minute per admin. Every response, errors included,
 * is `no-store`: admin data (full phone numbers, the full NID, signed links) never sits in a cache.
 */
export function createAdminRouter(deps: { storage: StorageProvider }): Router {
  const router = Router();
  router.use(noStore, requireAuth, requireRole('ADMIN'), adminLimiter);

  router.get('/kyc', validateQuery(kycListQuery), async (_req, res) => {
    res.json({ success: true, data: await listKyc(res.locals.query as KycListQuery) });
  });

  // The full NID and signed image links (no-store, as every admin response).
  router.get('/kyc/:id', validateParams(idParams), async (req, res) => {
    res.json({ success: true, data: await getKyc(idOf(res), deps.storage, actor(req)) });
  });

  router.patch('/kyc/:id', validateParams(idParams), validateBody(kycReviewBody), async (req, res) => {
    res.json({ success: true, data: await reviewKyc(idOf(res), req.body, actor(req)) });
  });

  router.get('/users', validateQuery(usersListQuery), async (_req, res) => {
    res.json({ success: true, data: await listUsers(res.locals.query as UsersListQuery) });
  });

  router.get('/users/:id', validateParams(idParams), async (_req, res) => {
    res.json({ success: true, data: await getUser(idOf(res)) });
  });

  router.patch('/users/:id/status', validateParams(idParams), validateBody(userStatusBody), async (req, res) => {
    res.json({ success: true, data: await changeUserStatus(idOf(res), req.body, actor(req)) });
  });

  router.post('/users/:id/unlock', validateParams(idParams), async (req, res) => {
    res.json({ success: true, data: await unlockUser(idOf(res), actor(req)) });
  });

  router.get('/audit-logs', validateQuery(auditListQuery), async (_req, res) => {
    res.json({ success: true, data: await listAudit(res.locals.query as AuditListQuery) });
  });

  return router;
}
