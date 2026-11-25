import { writeAudit } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import type { StorageProvider } from '../../lib/storage';
import { AppError } from '../../utils/AppError';
import { hashPin } from './pin';
import { invalidPin, verifyPinWithLockout } from './pinLockout';
import {
  accountFrozen,
  hashRefreshToken,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
} from './refresh.service';
import { signAccessToken } from './tokens';
import { toPublicUser } from './user.presenter';

type RequestMeta = { ip?: string; userAgent?: string };

// One message for "no such phone" and "wrong PIN".
const invalidCredentials = (details?: { attemptsLeft: number }) =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Phone number or PIN is incorrect', details);

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

  await verifyPinWithLockout(user, pin, {
    meta,
    wrongPin: (attemptsLeft) => invalidCredentials({ attemptsLeft }),
    failedAction: 'LOGIN_FAILED',
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

/**
 * Current PIN (under the shared login/money lockout) → new PIN. Every other session of the user
 * is logged out; the caller's own (the family of `rawRefreshToken`, if it is theirs) is kept.
 */
export async function changePin(input: {
  userId: string;
  currentPin: string;
  newPin: string;
  rawRefreshToken: string | undefined;
  meta: RequestMeta;
}): Promise<void> {
  const { userId, currentPin, newPin, rawRefreshToken, meta } = input;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, pinHash: true },
  });
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in again');

  await verifyPinWithLockout(user, currentPin, {
    meta,
    wrongPin: invalidPin,
    failedAction: 'PIN_CHANGE_FAILED',
  });
  // currentPin just matched the hash, so this compares the new PIN with the stored one.
  if (newPin === currentPin) {
    throw new AppError(422, 'PIN_UNCHANGED', 'The new PIN must be different from the current PIN');
  }
  const pinHash = await hashPin(newPin);

  const current = rawRefreshToken
    ? await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(rawRefreshToken) },
        select: { userId: true, family: true },
      })
    : null;
  // Someone else's cookie keeps nothing: then every session of this user ends.
  const keepFamily = current?.userId === userId ? current.family : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { pinHash } });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null, ...(keepFamily && { family: { not: keepFamily } }) },
      data: { revokedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId: userId,
      action: 'PIN_CHANGED',
      targetType: 'user',
      targetId: userId,
      ip: meta.ip,
    });
  });
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
