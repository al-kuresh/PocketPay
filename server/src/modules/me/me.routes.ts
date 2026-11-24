import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import type { StorageProvider } from '../../lib/storage';
import { requireAuth } from '../../middlewares/auth';
import { toPublicUser } from '../auth/user.presenter';
import { toPublicWallet } from '../wallets/wallet.presenter';
import { AppError } from '../../utils/AppError';

export function createMeRouter(deps: { storage: StorageProvider }): Router {
  const router = Router();

  // GET /api/v1/me → the signed-in user, in the same PublicUser shape as login returns.
  router.get('/', requireAuth, async (req, res) => {
    const user = req.user
      ? await prisma.user.findUnique({
          where: { id: req.user.id },
          include: { kycSubmissions: true, wallet: true },
        })
      : null;
    // A valid token for a user that no longer exists is treated like no token at all.
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in again');
    res.json({
      success: true,
      data: {
        user: toPublicUser(user, deps.storage),
        // Admins have no wallet.
        wallet: user.wallet ? toPublicWallet(user.wallet) : null,
      },
    });
  });

  return router;
}
