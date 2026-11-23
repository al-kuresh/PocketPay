import { Router } from 'express';
import type { OtpProvider } from '../../lib/otp';
import { validateBody } from '../../middlewares/validate';
import { createAuthController } from './auth.controller';
import { requestOtpBody, verifyOtpBody } from './auth.schemas';

export function createAuthRouter(deps: { otpProvider: OtpProvider }): Router {
  const router = Router();
  const auth = createAuthController(deps);

  router.post('/register/request-otp', validateBody(requestOtpBody), auth.requestOtp);
  router.post('/register/verify-otp', validateBody(verifyOtpBody), auth.verifyOtp);

  return router;
}
