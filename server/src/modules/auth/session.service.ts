import { writeAudit } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import type { StorageProvider } from '../../lib/storage';
import { AppError } from '../../utils/AppError';
import { verifyPin } from './pin';
import {
  accountFrozen,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
} from './refresh.service';
import { signAccessToken } from './tokens';
import { toPublicUser } from './user.presenter';

export const MAX_PIN_ATTEMPTS = 3;
export const LOCK_MS = 30 * 60 * 1000;

type RequestMeta = { ip?: string; userAgent?: string };

// One message for "no such phone" and "wrong PIN".
const invalidCredentials = (details?: { attemptsLeft: number }) =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Phone number or PIN is incorrect', details);
const accountLocked = (lockedUntil: Date) =>
  new AppError(423, 'ACCOUNT_LOCKED', 'Too many wrong PINs. Please try again later', {
    lockedUntil,
  });

/** Phone + PIN → a new session. PENDING_KYC and REJECTED users may log in; FROZEN may not. */
export async function login(input: {
  phone: string;
  pin: string;
  storage: StorageProvider;
  meta: RequestMeta;
}) {
  const { phone, pin, storage, meta } = input;
  const user = await prisma.user.findUnique({
    where: { phone },
    include: { kycSubmissions: true },
  });
  if (!user) throw invalidCredentials();

  const now = new Date();
  // Locked means locked, even for the right PIN.
  if (user.lockedUntil && user.lockedUntil > now) throw accountLocked(user.lockedUntil);

  // Claim one of the 3 attempts atomically BEFORE the slow bcrypt compare, so parallel
  // guesses can't all be compared before the lock lands. The claim also refuses while a lock
  // is in force (a request that read the user just before another one locked it).
  // shortcut: a crash between this claim and the lock write below leaves the counter at 3
  // with no lock, so the account stays locked. Phase 7 admin 'unlock account' resets
  // failedPinAttempts and lockedUntil.
  const claimed = await prisma.user
    .update({
      where: {
        id: user.id,
        failedPinAttempts: { lt: MAX_PIN_ATTEMPTS },
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
      data: { failedPinAttempts: { increment: 1 } },
      select: { failedPinAttempts: true },
    })
    .catch(async (e: unknown) => {
      if ((e as { code?: string }).code !== 'P2025') throw e;
      // Every attempt is held by a request still checking its PIN, or a lock just landed.
      const fresh = await prisma.user.findUnique({
        where: { id: user.id },
        select: { lockedUntil: true },
      });
      throw accountLocked(fresh?.lockedUntil ?? new Date(now.getTime() + LOCK_MS));
    });

  if (!(await verifyPin(pin, user.pinHash))) {
    if (claimed.failedPinAttempts >= MAX_PIN_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_MS);
      // Counter back to 0: once the lock expires the user gets a fresh 3 attempts.
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil, failedPinAttempts: 0 },
      });
      await writeAudit(prisma, {
        actorId: user.id,
        action: 'ACCOUNT_LOCKED',
        targetType: 'user',
        targetId: user.id,
        ip: meta.ip,
      });
      throw accountLocked(lockedUntil);
    }
    const attemptsLeft = MAX_PIN_ATTEMPTS - claimed.failedPinAttempts;
    await writeAudit(prisma, {
      actorId: user.id,
      action: 'LOGIN_FAILED',
      targetType: 'user',
      targetId: user.id,
      metadata: { attemptsLeft },
      ip: meta.ip,
    });
    throw invalidCredentials({ attemptsLeft });
  }

  // Right PIN: give back the attempt we claimed (and any earlier failures), clear any old lock.
  await prisma.user.update({
    where: { id: user.id },
    data: { failedPinAttempts: 0, lockedUntil: null },
  });
  if (user.status === 'FROZEN') throw accountFrozen();

  const refresh = await issueRefreshToken(prisma, { userId: user.id, ...meta });
  await writeAudit(prisma, {
    actorId: user.id,
    action: 'LOGIN_SUCCESS',
    targetType: 'user',
    targetId: user.id,
    ip: meta.ip,
  });
  return {
    user: toPublicUser(user, storage),
    accessToken: signAccessToken({ userId: user.id, role: user.role }),
    refresh,
  };
}

/** Refresh cookie → a rotated refresh token and a new access token. */
export async function refreshSession(
  rawToken: string | undefined,
  storage: StorageProvider,
  meta: RequestMeta,
) {
  // A missing cookie hashes to nothing in the table, so it gets the same 401 as a bad one.
  const rotated = await rotateRefreshToken(prisma, rawToken ?? '', meta);
  return {
    user: toPublicUser(rotated.user, storage),
    accessToken: signAccessToken({ userId: rotated.user.id, role: rotated.user.role }),
    refresh: { token: rotated.token, expiresAt: rotated.expiresAt },
  };
}

/** Revoke the cookie's refresh token, if any. Always succeeds. */
export async function logout(rawToken: string | undefined, meta: RequestMeta): Promise<void> {
  if (!rawToken) return;
  const userId = await revokeRefreshToken(prisma, rawToken);
  if (userId) {
    await writeAudit(prisma, {
      actorId: userId,
      action: 'LOGOUT',
      targetType: 'user',
      targetId: userId,
      ip: meta.ip,
    });
  }
}
