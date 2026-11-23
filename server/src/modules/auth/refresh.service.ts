import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../utils/AppError';

const refreshInvalid = () =>
  new AppError(401, 'REFRESH_TOKEN_INVALID', 'Your session has ended. Please log in again');
export const accountFrozen = () =>
  new AppError(403, 'ACCOUNT_FROZEN', 'This account is frozen. Please contact support');

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A rotated token presented again within this window is a concurrent refresh, not theft. */
export const REFRESH_REUSE_GRACE_MS = 10_000;

/** Only this hash is stored: a leaked refresh_tokens table can't be replayed as cookies. */
export const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Issue a refresh token for a session. A new login starts a new `family`; rotation (Task 6)
 * passes the existing family so reuse of an old token can revoke the whole chain.
 */
export async function issueRefreshToken(
  db: PrismaClient | Prisma.TransactionClient,
  opts: { userId: string; family?: string; userAgent?: string; ip?: string },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const { id } = await db.refreshToken.create({
    data: {
      userId: opts.userId,
      tokenHash: hashRefreshToken(token),
      family: opts.family ?? randomUUID(),
      expiresAt,
      userAgent: opts.userAgent,
      ip: opts.ip,
    },
    select: { id: true },
  });
  return { id, token, expiresAt };
}

/**
 * Swap a refresh token for a new one in the same family, in one transaction.
 * Presenting a token that was already rotated (or revoked) means it was copied: the whole
 * family is revoked, so whoever holds the newest token is logged out too.
 */
export async function rotateRefreshToken(
  db: PrismaClient,
  rawToken: string,
  meta: { userAgent?: string; ip?: string },
) {
  const now = new Date();
  const outcome = await db.$transaction(async (tx) => {
    const row = await tx.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
      include: { user: { include: { kycSubmissions: true } } },
    });
    if (!row || row.expiresAt <= now) throw refreshInvalid();

    // Claim the token with one conditional UPDATE. A token that is already revoked, or that a
    // parallel request claimed a moment ago, matches 0 rows.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (claimed.count === 0) {
      // Re-read: `row` may predate a parallel rotation that committed while we waited for the
      // row lock. Only the committed state says whether (and when) this token was rotated.
      const current = await tx.refreshToken.findUniqueOrThrow({
        where: { id: row.id },
        select: { revokedAt: true, replacedById: true },
      });
      const rotated = current.replacedById !== null;
      const rotatedJustNow =
        rotated &&
        current.revokedAt !== null &&
        now.getTime() - current.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
      // Rotated a moment ago by a parallel request (two tabs): nothing suspicious. 409, not 401,
      // so the client keeps its cookie (the winner just set a new one) and retries once.
      if (rotatedJustNow) {
        throw new AppError(409, 'REFRESH_IN_PROGRESS', 'Session is being refreshed. Please retry');
      }
      // Never rotated (revoked by logout or a family revoke): just refuse. Nothing to revoke.
      if (!rotated) throw refreshInvalid();

      // Rotated a while ago and presented again: someone has a copy. Revoke the family.
      await tx.refreshToken.updateMany({
        where: { family: row.family, revokedAt: null },
        data: { revokedAt: now },
      });
      await writeAudit(tx, {
        actorId: row.userId,
        action: 'REFRESH_TOKEN_REUSE',
        targetType: 'refresh_token_family',
        targetId: row.family,
        ip: meta.ip,
      });
      // Returned, not thrown: the revocation and the audit row must commit.
      return { reused: true as const };
    }

    if (row.user.status === 'FROZEN') throw accountFrozen(); // rolls the claim back

    const next = await issueRefreshToken(tx, { userId: row.userId, family: row.family, ...meta });
    await tx.refreshToken.update({ where: { id: row.id }, data: { replacedById: next.id } });
    return { reused: false as const, user: row.user, token: next.token, expiresAt: next.expiresAt };
  });

  if (outcome.reused) throw refreshInvalid();
  return outcome;
}

/**
 * Revoke one refresh token (logout). Idempotent: unknown or already-revoked tokens are fine.
 * Returns the owner's id so the caller can audit the logout, or null for an unknown token.
 */
export async function revokeRefreshToken(
  db: PrismaClient | Prisma.TransactionClient,
  rawToken: string,
): Promise<string | null> {
  const row = await db.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    select: { id: true, userId: true },
  });
  if (!row) return null;
  await db.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return row.userId;
}
