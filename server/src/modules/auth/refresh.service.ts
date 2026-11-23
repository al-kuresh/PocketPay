import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await db.refreshToken.create({
    data: {
      userId: opts.userId,
      tokenHash: hashRefreshToken(token),
      family: opts.family ?? randomUUID(),
      expiresAt,
      userAgent: opts.userAgent,
      ip: opts.ip,
    },
  });
  return { token, expiresAt };
}
