import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { Role } from '../../generated/prisma/enums';
import { AppError } from '../../utils/AppError';

const ACCESS_AUDIENCE = 'access';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Short-lived JWT the client keeps in memory and sends as `Authorization: Bearer …`. */
export function signAccessToken(claims: { userId: string; role: Role }): string {
  return jwt.sign({ role: claims.role }, env.JWT_SECRET, {
    algorithm: 'HS256',
    audience: ACCESS_AUDIENCE,
    subject: claims.userId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): { userId: string; role: Role } {
  try {
    // Pinned audience: a registration token (aud "registration") must not pass as a login.
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      audience: ACCESS_AUDIENCE,
    });
    if (
      typeof payload === 'object' &&
      typeof payload.sub === 'string' &&
      Object.values(Role).includes(payload.role)
    ) {
      return { userId: payload.sub, role: payload.role };
    }
  } catch {
    // Expired, bad signature, wrong audience: all reported the same way below.
  }
  throw new AppError(401, 'UNAUTHENTICATED', 'Please log in again');
}

export const REFRESH_COOKIE = 'pp_rt';

// Path-scoped to the auth routes: the browser never sends the refresh token anywhere else.
const refreshCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.NODE_ENV === 'production',
  path: '/api/v1/auth',
});

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, { ...refreshCookieOptions(), expires: expiresAt });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

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
