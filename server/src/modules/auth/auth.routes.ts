import { Router, type RequestHandler } from 'express';
import { bearerToken } from '../../middlewares/auth';
import { loginLimiter, otpLimiter } from '../../middlewares/rateLimit';
import { uploadKycImages } from '../../middlewares/upload';
import { validateBody } from '../../middlewares/validate';
import { createAuthController, type AuthDeps } from './auth.controller';
import {
  completeRegistrationBody,
  loginBody,
  requestOtpBody,
  verifyOtpBody,
} from './auth.schemas';
import { verifyRegistrationToken } from './tokens';

/** `Authorization: Bearer <registrationToken>` → res.locals.registration, or 401. */
const requireRegistrationToken: RequestHandler = (req, res, next) => {
  res.locals.registration = verifyRegistrationToken(bearerToken(req));
  next();
};

export function createAuthRouter(deps: AuthDeps): Router {
  const router = Router();
  const auth = createAuthController(deps);

  router.post(
    '/register/request-otp',
    otpLimiter,
    validateBody(requestOtpBody),
    auth.requestOtp,
  );
  router.post('/register/verify-otp', validateBody(verifyOtpBody), auth.verifyOtp);
  // Token first: a cheap check that rejects strangers before multer buffers up to 3 × 2 MB.
  router.post(
    '/register/complete',
    requireRegistrationToken,
    uploadKycImages,
    validateBody(completeRegistrationBody),
    auth.complete,
  );

  router.post('/login', loginLimiter, validateBody(loginBody), auth.login);
  // Both read the pp_rt cookie, which is path-scoped to /api/v1/auth.
  router.post('/refresh', auth.refresh);
  router.post('/logout', auth.logout);

  return router;
}
