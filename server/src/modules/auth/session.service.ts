import { writeAudit } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import type { StorageProvider } from '../../lib/storage';
import { AppError } from '../../utils/AppError';
import { verifyPinWithLockout } from './pinLockout';
import {
  accountFrozen,
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
