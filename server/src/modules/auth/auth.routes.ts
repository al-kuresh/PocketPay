import { Router, type RequestHandler } from 'express';
import { uploadKycImages } from '../../middlewares/upload';
import { validateBody } from '../../middlewares/validate';
import { createAuthController, type AuthDeps } from './auth.controller';
import { completeRegistrationBody, requestOtpBody, verifyOtpBody } from './auth.schemas';
import { verifyRegistrationToken } from './tokens';

/** `Authorization: Bearer <registrationToken>` → res.locals.registration, or 401. */
const requireRegistrationToken: RequestHandler = (req, res, next) => {
  const token = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1] ?? '';
  res.locals.registration = verifyRegistrationToken(token);
  next();
};

export function createAuthRouter(deps: AuthDeps): Router {
  const router = Router();
  const auth = createAuthController(deps);

  router.post('/register/request-otp', validateBody(requestOtpBody), auth.requestOtp);
  router.post('/register/verify-otp', validateBody(verifyOtpBody), auth.verifyOtp);
  // Token first: a cheap check that rejects strangers before multer buffers up to 3 × 2 MB.
  router.post(
    '/register/complete',
    requireRegistrationToken,
    uploadKycImages,
    validateBody(completeRegistrationBody),
    auth.complete,
  );

  return router;
}
