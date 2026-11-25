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

type Outcome =
  | { kind: 'ok' }
  | { kind: 'locked'; lockedUntil: Date } // already locked: no compare happened
  | { kind: 'lockedNow'; lockedUntil: Date } // this wrong PIN was the 3rd
  | { kind: 'wrong'; attemptsLeft: number };

/**
 * Checks `pin` against the user's hash under the shared lockout. Resolves on the right PIN;
 * otherwise throws `wrongPin(attemptsLeft)`, or 423 ACCOUNT_LOCKED when locked or on the 3rd failure.
 * The lockout state is always re-read under a row lock; the passed-in user only gives id and hash.
 */
export async function verifyPinWithLockout(
  user: Pick<User, 'id' | 'pinHash'>,
  pin: string,
  opts: {
    meta: { ip?: string };
    wrongPin: (attemptsLeft: number) => AppError;
    failedAction: 'LOGIN_FAILED' | 'TRANSACTION_PIN_FAILED';
  },
): Promise<void> {
  const outcome = await prisma.$transaction(
    async (tx): Promise<Outcome> => {
      // A row lock, not an attempt claim: PIN checks for one user run one at a time against the
      // fresh counter. Parallel guesses still compare at most 3 PINs, parallel right PINs all
      // pass (none is refused for an attempt another request holds), and a crash rolls the
      // whole check back, so there is no half-done state to clean up.
      const [row] = await tx.$queryRaw<
        { failed_pin_attempts: number; locked_until: Date | null }[]
      >`SELECT failed_pin_attempts, locked_until FROM users
        WHERE id = ${user.id}::uuid FOR NO KEY UPDATE`;
      if (!row) throw new Error(`verifyPinWithLockout: no user ${user.id}`);

      // Locked means locked, even for the right PIN.
      if (row.locked_until && row.locked_until > new Date()) {
        return { kind: 'locked', lockedUntil: row.locked_until };
      }

      if (await verifyPin(pin, user.pinHash)) {
        // Clear any earlier failures and any expired lock.
        await tx.user.update({
          where: { id: user.id },
          data: { failedPinAttempts: 0, lockedUntil: null },
        });
        return { kind: 'ok' };
      }

      const failed = row.failed_pin_attempts + 1;
      if (failed >= MAX_PIN_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCK_MS);
        // Counter back to 0: once the lock expires the user gets a fresh 3 attempts.
        await tx.user.update({
          where: { id: user.id },
          data: { lockedUntil, failedPinAttempts: 0 },
        });
        return { kind: 'lockedNow', lockedUntil };
      }
      await tx.user.update({ where: { id: user.id }, data: { failedPinAttempts: failed } });
      return { kind: 'wrong', attemptsLeft: MAX_PIN_ATTEMPTS - failed };
    },
    { timeout: 10_000 },
  );

  // Audit and throw only after the commit: throwing inside would roll back the counter.
  const audit = (action: 'ACCOUNT_LOCKED' | typeof opts.failedAction, metadata?: object) =>
    writeAudit(prisma, {
      actorId: user.id,
      action,
      targetType: 'user',
      targetId: user.id,
      metadata,
      ip: opts.meta.ip,
    });
  switch (outcome.kind) {
    case 'ok':
      return;
    case 'locked':
      throw accountLocked(outcome.lockedUntil);
    case 'lockedNow':
      await audit('ACCOUNT_LOCKED');
      throw accountLocked(outcome.lockedUntil);
    case 'wrong':
      await audit(opts.failedAction, { attemptsLeft: outcome.attemptsLeft });
      throw opts.wrongPin(outcome.attemptsLeft);
  }
}
