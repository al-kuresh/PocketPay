import type { User } from '../../generated/prisma/client';
import { writeAudit } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/AppError';
import { verifyPin } from './pin';

// One counter for login and money requests: 3 wrong PINs on either lock both.
export const MAX_PIN_ATTEMPTS = 3;
export const LOCK_MS = 30 * 60 * 1000;

const accountLocked = (lockedUntil: Date) =>
  new AppError(423, 'ACCOUNT_LOCKED', 'Too many wrong PINs. Please try again later', {
    lockedUntil,
  });

/** The wrong-PIN error for money requests (login uses INVALID_CREDENTIALS instead). */
export const invalidPin = (attemptsLeft: number) =>
  new AppError(403, 'INVALID_PIN', 'Wrong PIN', { attemptsLeft });

/**
 * Checks `pin` against the user's hash under the shared lockout. Resolves on the right PIN;
 * otherwise throws `wrongPin(attemptsLeft)`, or 423 ACCOUNT_LOCKED when locked or on the 3rd failure.
 */
export async function verifyPinWithLockout(
  user: Pick<User, 'id' | 'pinHash' | 'lockedUntil'>,
  pin: string,
  opts: {
    meta: { ip?: string };
    wrongPin: (attemptsLeft: number) => AppError;
    failedAction: 'LOGIN_FAILED' | 'TRANSACTION_PIN_FAILED';
  },
): Promise<void> {
  const { meta } = opts;
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
      action: opts.failedAction,
      targetType: 'user',
      targetId: user.id,
      metadata: { attemptsLeft },
      ip: meta.ip,
    });
    throw opts.wrongPin(attemptsLeft);
  }

  // Right PIN: give back the attempt we claimed (and any earlier failures), clear any old lock.
  await prisma.user.update({
    where: { id: user.id },
    data: { failedPinAttempts: 0, lockedUntil: null },
  });
}
