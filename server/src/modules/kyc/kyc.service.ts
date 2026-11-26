import { writeAudit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import type { StorageProvider } from '../../lib/storage';
import { AppError } from '../../utils/AppError';
import { LATEST_FIRST, lockUser } from '../admin/admin.shared';
import { toPublicUser } from '../auth/user.presenter';
import { LEDGER_TX_OPTIONS } from '../ledger/ledger.service';
import { deleteObjects, documentRows, type KycImages, prepareKycObjects, uploadObjects } from './kycDocuments';

const resubmitNotAllowed = () =>
  new AppError(409, 'KYC_RESUBMIT_NOT_ALLOWED', 'Documents can only be sent again after a rejection');

const KYC_FIELDS = { status: true, reason: true, submittedAt: true, reviewedAt: true } as const;

/** GET /kyc: the caller's latest submission, or null. */
export const getMyKyc = (userId: string) =>
  prisma.kycSubmission.findFirst({ where: { userId }, orderBy: LATEST_FIRST, select: KYC_FIELDS });

/**
 * A REJECTED user sends 3 new images. Uploads happen first; then one transaction under the user
 * row lock re-checks REJECTED, so of two parallel resubmits exactly one creates a submission and
 * the other is a 409 whose uploads are deleted. Old documents and submissions stay (history).
 */
export async function resubmitKyc(input: {
  userId: string;
  images: KycImages;
  storage: StorageProvider;
  kycAutoApprove: boolean;
  ip?: string;
}) {
  const { userId, images, storage, kycAutoApprove, ip } = input;

  // Fail early, before any image work or upload. The check under the lock below is the real guard.
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!before) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in again');
  if (before.status !== 'REJECTED') throw resubmitNotAllowed();

  const objs = await prepareKycObjects(userId, images);
  await uploadObjects(storage, objs.all);

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const user = await lockUser(tx, userId);
      if (user.status !== 'REJECTED') throw resubmitNotAllowed();
      const { profilePhotoKey: oldKey } = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { profilePhotoKey: true },
      });

      // The same rule as registration: auto-approve is for customers only.
      const autoApproved = kycAutoApprove && user.role === 'CUSTOMER';
      await tx.userDocument.createMany({ data: documentRows(userId, objs.all) });
      // The old PROFILE row would point at an object deleted below.
      if (oldKey) await tx.userDocument.deleteMany({ where: { userId, kind: 'PROFILE', storageKey: oldKey } });
      const submission = await tx.kycSubmission.create({
        data: {
          userId,
          nidFrontId: objs.front.id,
          nidBackId: objs.back.id,
          selfieId: objs.selfie.id,
          ...(autoApproved && { status: 'APPROVED', reason: 'auto-approved', reviewedAt: new Date() }),
        },
        select: { id: true, ...KYC_FIELDS },
      });
      const updated = await tx.user.update({
        where: { id: userId },
        data: { status: autoApproved ? 'ACTIVE' : 'PENDING_KYC', profilePhotoKey: objs.profile.key },
        include: { kycSubmissions: true },
      });
      // Ids and a flag only: never the NID, the images or their keys.
      await writeAudit(tx, {
        actorId: userId,
        action: 'KYC_RESUBMITTED',
        targetType: 'user',
        targetId: userId,
        metadata: { submissionId: submission.id, autoApproved },
        ip,
      });
      return { user: updated, submission, oldKey };
    }, LEDGER_TX_OPTIONS);
  } catch (err) {
    // Nothing was committed, so nothing points at the new objects.
    await deleteObjects(storage, objs.all);
    throw err;
  }

  // After the commit: a failed delete leaves an orphan to clean up, never a failed request.
  if (result.oldKey) {
    await storage
      .delete(result.oldKey, 'PUBLIC')
      .catch(() => logger.warn({ kind: 'PROFILE', access: 'PUBLIC' }, 'Old profile photo delete failed'));
  }
  const { status, reason, submittedAt, reviewedAt } = result.submission;
  return { user: toPublicUser(result.user, storage), kyc: { status, reason, submittedAt, reviewedAt } };
}
