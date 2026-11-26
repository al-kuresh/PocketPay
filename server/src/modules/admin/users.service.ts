import type { Prisma, User } from '../../generated/prisma/client';
import type { KycStatus } from '../../generated/prisma/enums';
import { writeAudit } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import { maskNid } from '../../utils/mask';
import { poishaToString } from '../../utils/money';
import { LEDGER_TX_OPTIONS } from '../ledger/ledger.service';
import { type Actor, LATEST_FIRST, lockUser, pageArgs, toPage, userNotFound, userStatusChanged } from './admin.shared';
import type { UserStatusBody, UsersListQuery } from './admin.schemas';
import { recentAuditFor } from './audit.service';

const NEWEST_FIRST = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
const latestKyc = { kycSubmissions: { orderBy: LATEST_FIRST, take: 1, select: { id: true, status: true } } };

// An allowlist: no pinHash, no full NID, no date of birth.
const toUserItem = (u: User & { kycSubmissions: { status: KycStatus }[] }) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  role: u.role,
  status: u.status,
  shopName: u.shopName,
  nidMasked: maskNid(u.nidNumber),
  kycStatus: u.kycSubmissions[0]?.status ?? null,
  lockedUntil: u.lockedUntil,
  createdAt: u.createdAt,
});

/** Search users, newest first, keyset-paged. */
export async function listUsers(q: UsersListQuery) {
  const where: Prisma.UserWhereInput = {
    role: q.role,
    status: q.status,
    ...(q.q !== undefined && {
      OR: [
        { phone: { startsWith: q.q } },
        { name: { contains: q.q, mode: 'insensitive' } },
        // Only a full NID matches: a partial one would let a search walk through NIDs.
        ...(/^\d{10}$/.test(q.q) ? [{ nidNumber: q.q }] : []),
      ],
    }),
  };
  const rows = await prisma.user.findMany({
    where,
    orderBy: NEWEST_FIRST,
    include: latestKyc,
    ...pageArgs(q.cursor, q.limit),
  });
  const { page, nextCursor } = toPage(rows, q.cursor, q.limit);
  return { items: page.map(toUserItem), nextCursor };
}

/** One user for the admin: the list fields, the PIN counter, balance, latest KYC, recent audit. */
export async function getUser(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, include: { ...latestKyc, wallet: true } });
  if (!u) throw userNotFound();
  return {
    ...toUserItem(u),
    failedPinAttempts: u.failedPinAttempts,
    balance: u.wallet ? poishaToString(u.wallet.balance) : null, // admins have no wallet
    latestKyc: u.kycSubmissions[0] ?? null,
    recentAudit: await recentAuditFor(id),
  };
}

/**
 * FREEZE (only from ACTIVE) or UNFREEZE (only from FROZEN, back to ACTIVE), under the user row
 * lock. Freezing also revokes every refresh token, so the user's sessions end at once; a
 * still-valid access token is refused by the money guard (status is read per request).
 */
export async function changeUserStatus(id: string, body: UserStatusBody, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, id);
    const freeze = body.action === 'FREEZE';
    if (user.status !== (freeze ? 'ACTIVE' : 'FROZEN')) throw userStatusChanged(user.status);

    const status = freeze ? 'FROZEN' : 'ACTIVE';
    await tx.user.update({ where: { id }, data: { status } });
    if (freeze) {
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: freeze ? 'USER_FROZEN' : 'USER_UNFROZEN',
      targetType: 'user',
      targetId: id,
      metadata: { userId: id, reason: body.reason },
      ip: actor.ip,
    });
    return { id, status };
  }, LEDGER_TX_OPTIONS);
}

/** Clear a PIN lockout under the user row lock. Not locked → no change and no audit row. */
export async function unlockUser(id: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, id);
    if (!user.locked_until || user.locked_until <= new Date()) return { id, unlocked: false };

    await tx.user.update({ where: { id }, data: { failedPinAttempts: 0, lockedUntil: null } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'USER_UNLOCKED',
      targetType: 'user',
      targetId: id,
      metadata: { userId: id },
      ip: actor.ip,
    });
    return { id, unlocked: true };
  }, LEDGER_TX_OPTIONS);
}
