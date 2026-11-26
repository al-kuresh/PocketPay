import type { Prisma } from '../../generated/prisma/client';
import type { Role, UserStatus } from '../../generated/prisma/enums';
import { AppError } from '../../utils/AppError';

/** Who did an admin action, for the audit row. */
export interface Actor {
  id: string;
  ip?: string;
}

export const userNotFound = () => new AppError(404, 'USER_NOT_FOUND', 'User not found');
export const cannotModifyAdmin = () =>
  new AppError(422, 'CANNOT_MODIFY_ADMIN', "Admin accounts can't be changed here");
export const userStatusChanged = (status: UserStatus) =>
  new AppError(409, 'USER_STATUS_CHANGED', "This user's status has changed. Please reload", { status });

/**
 * Locks the user row for the rest of the transaction (`FOR NO KEY UPDATE`, as in
 * verifyPinWithLockout) and returns its state as of the lock. Every admin status change runs
 * under this lock, so two admins acting on one user take turns and the second sees the first's
 * commit. Unknown user → 404. An admin (the caller included) → 422.
 */
export async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  const [row] = await tx.$queryRaw<{ role: Role; status: UserStatus; locked_until: Date | null }[]>`
    SELECT role::text AS role, status::text AS status, locked_until FROM users
    WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
  if (!row) throw userNotFound();
  if (row.role === 'ADMIN') throw cannotModifyAdmin();
  return row;
}

/** A user's latest KYC submission is the first in this order. */
export const LATEST_FIRST = [{ submittedAt: 'desc' as const }, { id: 'desc' as const }];

/**
 * Keyset paging on `orderBy` + id, like history. Prisma's `cursor` compares against the cursor
 * row inside SQL, so sub-millisecond timestamps can't skip rows. No `skip: 1`: if the cursor row
 * left the filter meanwhile (a PENDING submission got reviewed), skip would drop a real row, so
 * take 2 extra (the cursor row, and one to tell if there's a next page) and drop it by id.
 */
export const pageArgs = (cursor: string | undefined, limit: number) => ({
  ...(cursor !== undefined && { cursor: { id: cursor } }),
  take: limit + 2,
});

export function toPage<T extends { id: string }>(rows: T[], cursor: string | undefined, limit: number) {
  const rest = rows.filter((r) => r.id !== cursor);
  const page = rest.slice(0, limit);
  return { page, nextCursor: rest.length > limit ? page[page.length - 1]!.id : null };
}
