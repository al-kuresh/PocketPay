import { Router } from 'express';
import type { StorageProvider } from '../../lib/storage';
import { requireAuth } from '../../middlewares/auth';
import { kycResubmitLimiter } from '../../middlewares/rateLimit';
import { kycImagesFrom, uploadKycImages } from '../../middlewares/upload';
import { getMyKyc, resubmitKyc } from './kyc.service';

/** /api/v1/kyc: the signed-in user's own KYC. */
export function createKycRouter(deps: { storage: StorageProvider; kycAutoApprove: boolean }): Router {
  const router = Router();

  router.get('/', requireAuth, async (req, res) => {
    res.json({ success: true, data: await getMyKyc(req.user!.id) });
  });

  // Token and the per-user limit first: they reject before multer buffers up to 3 × 10 MB.
  router.post('/resubmit', requireAuth, kycResubmitLimiter, uploadKycImages, async (req, res) => {
    const data = await resubmitKyc({
      userId: req.user!.id,
      images: kycImagesFrom(req),
      storage: deps.storage,
      kycAutoApprove: deps.kycAutoApprove,
      ip: req.ip,
    });
    res.status(201).json({ success: true, data });
  });

  return router;
}
