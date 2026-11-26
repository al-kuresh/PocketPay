import { writeAudit } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import type { StorageProvider } from '../../lib/storage';
import { AppError } from '../../utils/AppError';
import { maskNid } from '../../utils/mask';
import { LEDGER_TX_OPTIONS } from '../ledger/ledger.service';
import { type Actor, LATEST_FIRST, lockUser, pageArgs, toPage, userStatusChanged } from './admin.shared';
import type { KycListQuery, KycReviewBody } from './admin.schemas';

/** Signed image links last 5 minutes and are made per request, never stored. */
export const KYC_LINK_TTL_S = 300;

const kycNotFound = () => new AppError(404, 'KYC_NOT_FOUND', 'KYC submission not found');
const alreadyReviewed = () =>
  new AppError(409, 'KYC_ALREADY_REVIEWED', 'This submission has already been reviewed');
const notLatest = () =>
  new AppError(409, 'KYC_NOT_LATEST', 'The user has sent a newer submission');

/** The queue: PENDING oldest first (fair), the rest newest first. `pendingCount` is for the badge. */
export async function listKyc(q: KycListQuery) {
  const dir = q.status === 'PENDING' ? 'asc' : 'desc';
  const [rows, pendingCount] = await Promise.all([
    prisma.kycSubmission.findMany({
      where: { status: q.status },
      orderBy: [{ submittedAt: dir }, { id: dir }],
      select: {
        id: true,
        submittedAt: true,
        status: true,
        user: { select: { id: true, name: true, phone: true, role: true, shopName: true, nidNumber: true } },
      },
      ...pageArgs(q.cursor, q.limit),
    }),
    prisma.kycSubmission.count({ where: { status: 'PENDING' } }),
  ]);
  const { page, nextCursor } = toPage(rows, q.cursor, q.limit);
  return {
    items: page.map(({ user: { nidNumber, ...user }, ...s }) => ({
      ...s,
      user: { ...user, nidMasked: maskNid(nidNumber) },
    })),
    nextCursor,
    pendingCount,
  };
}

/**
 * One submission for review: the only response with the full NID. Image links are signed for
 * 5 minutes. The view is audited right after the read.
 */
export async function getKyc(id: string, storage: StorageProvider, actor: Actor) {
  const s = await prisma.kycSubmission.findUnique({
    where: { id },
    include: {
      user: true,
      reviewedBy: { select: { id: true, name: true } },
      nidFront: { select: { storageKey: true } },
      nidBack: { select: { storageKey: true } },
      selfie: { select: { storageKey: true } },
    },
  });
  if (!s) throw kycNotFound();

  const all = await prisma.kycSubmission.findMany({
    where: { userId: s.userId },
    orderBy: LATEST_FIRST,
    select: { id: true, status: true, submittedAt: true, reason: true },
  });
  const [nidFront, nidBack, selfie] = await Promise.all(
    [s.nidFront, s.nidBack, s.selfie].map((d) => storage.signedUrl(d.storageKey, KYC_LINK_TTL_S)),
  );

  // Ids only: never the NID, the links or the storage keys.
  await writeAudit(prisma, {
    actorId: actor.id,
    action: 'KYC_VIEWED',
    targetType: 'user',
    targetId: s.userId,
    metadata: { submissionId: s.id, userId: s.userId },
    ip: actor.ip,
  });

  const u = s.user;
  return {
    id: s.id,
    status: s.status,
    submittedAt: s.submittedAt,
    reviewedAt: s.reviewedAt,
    reason: s.reason,
    reviewedBy: s.reviewedBy,
    isLatest: all[0]?.id === s.id,
    // An allowlist, as toPublicUser: a new column can't leak by accident.
    user: {
      id: u.id,
      name: u.name,
      phone: u.phone,
      role: u.role,
      shopName: u.shopName,
      dateOfBirth: u.dateOfBirth.toISOString().slice(0, 10), // a UTC DATE: never local time
      nidNumber: u.nidNumber,
      status: u.status,
    },
    images: { nidFront, nidBack, selfie },
    // The user's other submissions, newest first.
    history: all.filter((h) => h.id !== s.id),
  };
}

/**
 * Approve or reject, in one transaction under the user row lock. Only the user's latest,
 * still-PENDING submission of a PENDING_KYC user can be decided; anything else is a 409, so
 * two admins at once get exactly one winner.
 */
export async function reviewKyc(id: string, body: KycReviewBody, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.kycSubmission.findUnique({ where: { id }, select: { userId: true } });
    if (!target) throw kycNotFound();
    const { userId } = target;
    const user = await lockUser(tx, userId);

    // Re-read under the lock: whatever another admin committed is visible now.
    const s = await tx.kycSubmission.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (s.status !== 'PENDING') throw alreadyReviewed();
    const latest = await tx.kycSubmission.findFirst({ where: { userId }, orderBy: LATEST_FIRST, select: { id: true } });
    if (latest?.id !== id) throw notLatest();
    if (user.status !== 'PENDING_KYC') throw userStatusChanged(user.status);

    const approve = body.decision === 'APPROVE';
    const reason = approve ? null : body.reason;
    const reviewedAt = new Date();
    // Conditional, on top of the lock: a second decision can never overwrite the first.
    const claimed = await tx.kycSubmission.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedById: actor.id, reviewedAt, reason },
    });
    if (claimed.count !== 1) throw alreadyReviewed();

    const status = approve ? 'ACTIVE' : 'REJECTED';
    await tx.user.update({ where: { id: userId }, data: { status } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: approve ? 'KYC_APPROVED' : 'KYC_REJECTED',
      targetType: 'user',
      targetId: userId,
      metadata: { submissionId: id, userId, ...(reason !== null && { reason }) },
      ip: actor.ip,
    });
    return {
      id,
      status: approve ? ('APPROVED' as const) : ('REJECTED' as const),
      reviewedAt,
      reason,
      user: { id: userId, status },
    };
  }, LEDGER_TX_OPTIONS);
}
