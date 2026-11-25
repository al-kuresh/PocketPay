import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import type { StorageProvider } from '../../lib/storage';
import { requireAuth } from '../../middlewares/auth';
import { uploadProfilePhoto } from '../../middlewares/upload';
import { changeProfilePhoto } from './photo.service';
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

  // PUT /api/v1/me/photo → a new public profile photo. Token first: strangers are rejected
  // before multer buffers up to 2 MB.
  router.put('/photo', requireAuth, uploadProfilePhoto, async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'MISSING_FILE', 'Please upload the photo image', { field: 'photo' });
    }
    const user = await changeProfilePhoto({
      userId: req.user!.id,
      image: req.file.buffer,
      storage: deps.storage,
    });
    res.json({ success: true, data: { user } });
  });

  return router;
}
