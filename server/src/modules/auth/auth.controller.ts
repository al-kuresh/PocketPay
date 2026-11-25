import type { Request, RequestHandler } from 'express';
import type { OtpProvider } from '../../lib/otp';
import type { StorageProvider } from '../../lib/storage';
import { AppError } from '../../utils/AppError';
import { requestOtp, verifyOtp } from './otp.service';
import { completeRegistration, type KycImages } from './registration.service';
import { changePin, login, logout, refreshSession } from './session.service';
import {
  clearRefreshCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
  type RegistrationClaims,
} from './tokens';

const requestMeta = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

/** The pp_rt cookie, only if it's a plain string (cookie-parser turns "j:…" into objects). */
const refreshCookieValue = (req: Request): string | undefined => {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value ? value : undefined;
};

export interface AuthDeps {
  otpProvider: OtpProvider;
  storage: StorageProvider;
  kycAutoApprove: boolean;
}

const KYC_FILES = ['nidFront', 'nidBack', 'selfie'] as const;

// Thin layer: read the (already validated) request, call the service, send the response.
export function createAuthController(deps: AuthDeps) {
  const requestOtpHandler: RequestHandler = async (req, res) => {
    res.json({ success: true, data: await requestOtp(req.body.phone, deps.otpProvider) });
  };

  const verifyOtpHandler: RequestHandler = async (req, res) => {
    res.json({ success: true, data: await verifyOtp(req.body.phone, req.body.code) });
  };

  const completeHandler: RequestHandler = async (req, res) => {
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const images = {} as KycImages;
    for (const field of KYC_FILES) {
      const file = files[field]?.[0];
      if (!file) {
        throw new AppError(400, 'MISSING_FILE', `Please upload the ${field} image`, { field });
      }
      images[field] = file.buffer;
    }

    const result = await completeRegistration({
      claims: res.locals.registration as RegistrationClaims,
      body: req.body,
      images,
      storage: deps.storage,
      kycAutoApprove: deps.kycAutoApprove,
      meta: requestMeta(req),
    });

    setRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    res.status(201).json({
      success: true,
      data: { user: result.user, accessToken: result.accessToken },
    });
  };

  const loginHandler: RequestHandler = async (req, res) => {
    const result = await login({
      phone: req.body.phone,
      pin: req.body.pin,
      storage: deps.storage,
      meta: requestMeta(req),
    });
    setRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    res.json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
  };

  const refreshHandler: RequestHandler = async (req, res) => {
    try {
      const result = await refreshSession(refreshCookieValue(req), deps.storage, requestMeta(req));
      setRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
      res.json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
    } catch (err) {
      // The cookie is dead (or the account frozen): remove it so the client stops sending it.
      // Except REFRESH_IN_PROGRESS: a parallel request just set a new cookie, and clearing it
      // here would arrive after that and log the user out.
      if (!(err instanceof AppError && err.code === 'REFRESH_IN_PROGRESS')) clearRefreshCookie(res);
      throw err;
    }
  };

  const logoutHandler: RequestHandler = async (req, res) => {
    try {
      await logout(refreshCookieValue(req), requestMeta(req));
    } finally {
      // Cleared even if revoking failed: the browser should forget the session either way.
      clearRefreshCookie(res);
    }
    res.status(204).end();
  };

  const changePinHandler: RequestHandler = async (req, res) => {
    await changePin({
      userId: req.user!.id,
      currentPin: req.body.currentPin,
      newPin: req.body.newPin,
      // Sent here because /auth/pin is under the cookie's /api/v1/auth path.
      rawRefreshToken: refreshCookieValue(req),
      meta: requestMeta(req),
    });
    res.status(204).end();
  };

  return {
    changePin: changePinHandler,
    requestOtp: requestOtpHandler,
    verifyOtp: verifyOtpHandler,
    complete: completeHandler,
    login: loginHandler,
    refresh: refreshHandler,
    logout: logoutHandler,
  };
}
