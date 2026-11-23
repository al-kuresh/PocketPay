import type { RequestHandler } from 'express';
import type { OtpProvider } from '../../lib/otp';
import type { StorageProvider } from '../../lib/storage';
import { AppError } from '../../utils/AppError';
import { requestOtp, verifyOtp } from './otp.service';
import { completeRegistration, type KycImages } from './registration.service';
import { setRefreshCookie, type RegistrationClaims } from './tokens';

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
      meta: { ip: req.ip, userAgent: req.get('user-agent') },
    });

    setRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    res.status(201).json({
      success: true,
      data: { user: result.user, accessToken: result.accessToken },
    });
  };

  return { requestOtp: requestOtpHandler, verifyOtp: verifyOtpHandler, complete: completeHandler };
}
