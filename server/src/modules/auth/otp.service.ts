import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import type { OtpProvider } from '../../lib/otp';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/AppError';
import { REGISTRATION_TOKEN_TTL_SECONDS, signRegistrationToken } from './tokens';

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;

/** Keyed hash: a leaked otp_codes table can't be brute-forced without JWT_SECRET. */
const hashOtp = (phone: string, code: string) =>
  createHmac('sha256', env.JWT_SECRET).update(`${phone}:${code}`).digest('hex');

const otpLocked = () =>
  new AppError(429, 'OTP_LOCKED', 'Too many wrong attempts. Please request a new code');

export async function requestOtp(phone: string, otpProvider: OtpProvider) {
  if (await prisma.user.findUnique({ where: { phone }, select: { id: true } })) {
    throw new AppError(409, 'PHONE_TAKEN', 'An account with this phone number already exists');
  }

  const now = Date.now();
  // Known v1 race: two parallel requests can both pass this check; only the newest code stays
  // valid. Bounded by the cooldown and the IP rate limiter (Task 7).
  const last = await prisma.otpCode.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const waitMs = last ? last.createdAt.getTime() + OTP_RESEND_SECONDS * 1000 - now : 0;
  if (waitMs > 0) {
    throw new AppError(429, 'OTP_COOLDOWN', 'Please wait before requesting another code', {
      retryAfterSeconds: Math.ceil(waitMs / 1000),
    });
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const [, created] = await prisma.$transaction([
    // Only the newest code is valid: retire any earlier unused ones.
    prisma.otpCode.updateMany({
      where: { phone, consumedAt: null },
      data: { consumedAt: new Date(now) },
    }),
    prisma.otpCode.create({
      data: {
        phone,
        codeHash: hashOtp(phone, code),
        purpose: 'REGISTER',
        expiresAt: new Date(now + OTP_TTL_SECONDS * 1000),
      },
      select: { id: true },
    }),
  ]);

  try {
    await otpProvider.send(phone, code);
  } catch {
    // The user never got this code: remove it so it can't trigger the cooldown.
    await prisma.otpCode.delete({ where: { id: created.id } });
    throw new AppError(502, 'OTP_SEND_FAILED', 'Could not send the code. Please try again');
  }

  return {
    expiresInSeconds: OTP_TTL_SECONDS,
    resendInSeconds: OTP_RESEND_SECONDS,
    ...(env.OTP_DEV_ECHO && { devOtp: code }),
  };
}

export async function verifyOtp(phone: string, code: string) {
  const otp = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp || otp.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, 'OTP_EXPIRED', 'This code has expired. Please request a new one');
  }

  // Claim an attempt atomically BEFORE comparing, so parallel guesses can't exceed the limit.
  // The returned row holds the post-increment count, which is what this request is judged on.
  const claimed = await prisma.otpCode
    .update({
      where: { id: otp.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    })
    .catch((e: unknown) => {
      // P2025 = no row matched: the attempts are already used up.
      if ((e as { code?: string }).code === 'P2025') throw otpLocked();
      throw e;
    });

  const expected = Buffer.from(otp.codeHash, 'hex');
  const actual = Buffer.from(hashOtp(phone, code), 'hex');
  if (!timingSafeEqual(expected, actual)) {
    const attemptsUsed = claimed.attempts;
    if (attemptsUsed >= OTP_MAX_ATTEMPTS) throw otpLocked();
    throw new AppError(400, 'OTP_INVALID', 'Incorrect code', {
      attemptsLeft: OTP_MAX_ATTEMPTS - attemptsUsed,
    });
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { verifiedAt: new Date() } });
  return {
    registrationToken: signRegistrationToken({ phone, otpId: otp.id }),
    expiresInSeconds: REGISTRATION_TOKEN_TTL_SECONDS,
  };
}
