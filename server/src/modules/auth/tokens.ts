import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';

const REGISTRATION_AUDIENCE = 'registration';
export const REGISTRATION_TOKEN_TTL_SECONDS = 15 * 60;

export interface RegistrationClaims {
  phone: string;
  otpId: string;
}

/** Short-lived proof that `phone` passed OTP verification. Consumed once in step 4. */
export function signRegistrationToken(claims: RegistrationClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    audience: REGISTRATION_AUDIENCE,
    expiresIn: REGISTRATION_TOKEN_TTL_SECONDS,
  });
}

export function verifyRegistrationToken(token: string): RegistrationClaims {
  try {
    // Pin the algorithm and audience: an access token (aud "access") must not pass here.
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      audience: REGISTRATION_AUDIENCE,
    });
    if (
      typeof payload === 'object' &&
      typeof payload.phone === 'string' &&
      typeof payload.otpId === 'string'
    ) {
      return { phone: payload.phone, otpId: payload.otpId };
    }
  } catch {
    // Expired, bad signature, wrong audience: all reported the same way below.
  }
  throw new AppError(
    401,
    'REGISTRATION_TOKEN_INVALID',
    'Registration session is invalid or has expired',
  );
}
