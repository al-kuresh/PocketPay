import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import { violatedUniqueIndex } from '../../lib/prismaErrors';
import { deleteObjects, documentRows, type KycImages, prepareKycObjects, uploadObjects } from '../kyc/kycDocuments';
import type { StorageProvider } from '../../lib/storage';
import { AppError } from '../../utils/AppError';
import type { completeRegistrationBody } from './auth.schemas';
import { hashPin } from './pin';
import { issueRefreshToken } from './refresh.service';
import { signAccessToken, type RegistrationClaims } from './tokens';
import { toPublicUser } from './user.presenter';

export type CompleteRegistrationInput = z.output<typeof completeRegistrationBody>;
export type { KycImages };

const tokenInvalid = () =>
  new AppError(401, 'REGISTRATION_TOKEN_INVALID', 'Registration session is invalid or has expired');
const phoneTaken = () =>
  new AppError(409, 'PHONE_TAKEN', 'An account with this phone number already exists');
const nidTaken = () => new AppError(409, 'NID_TAKEN', 'An account with this NID already exists');

export async function completeRegistration(input: {
  claims: RegistrationClaims;
  body: CompleteRegistrationInput;
  images: KycImages;
  storage: StorageProvider;
  kycAutoApprove: boolean;
  meta: { ip?: string; userAgent?: string };
}) {
  const { claims, body, images, storage, kycAutoApprove, meta } = input;

  // 1. The token must point at a verified, still-unused OTP for the same phone.
  const otp = await prisma.otpCode.findUnique({ where: { id: claims.otpId } });
  if (!otp || otp.phone !== claims.phone || !otp.verifiedAt || otp.consumedAt) {
    throw tokenInvalid();
  }

  // 2. Fail early, before any image work or upload. (The unique indexes are the real guard.)
  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone: claims.phone }, { nidNumber: body.nidNumber }] },
    select: { phone: true },
  });
  if (existing) throw existing.phone === claims.phone ? phoneTaken() : nidTaken();

  // 3. Check and re-encode every image (415 on a bad file) before uploading anything.
  const userId = randomUUID();
  const objs = await prepareKycObjects(userId, images);
  const pinHash = await hashPin(body.pin);

  // 4. Upload. On a partial failure the uploaded ones are deleted and this is a 502.
  await uploadObjects(storage, objs.all);

  let created;
  try {
    // 5. Everything in one transaction: either the whole account exists, or none of it does.
    const autoApproved = kycAutoApprove && body.role === 'CUSTOMER';
    created = await prisma.$transaction(async (tx) => {
      // Single use: of two parallel requests with the same token, the second waits on this
      // row's lock, then sees consumedAt already set and matches 0 rows.
      // Must stay a single UPDATE ... WHERE consumed_at IS NULL — a read-then-update would
      // reintroduce the double-registration race.
      const consumed = await tx.otpCode.updateMany({
        where: { id: otp.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw tokenInvalid();

      await tx.user.create({
        data: {
          id: userId,
          phone: claims.phone,
          nidNumber: body.nidNumber,
          name: body.name,
          // 'YYYY-MM-DD' parses as UTC midnight: the stored DATE is exactly the given day.
          dateOfBirth: new Date(body.dateOfBirth),
          shopName: 'shopName' in body ? body.shopName : null,
          pinHash,
          role: body.role,
          status: autoApproved ? 'ACTIVE' : 'PENDING_KYC',
          profilePhotoKey: objs.profile.key,
        },
      });
      // Registration roles are a subset of wallet types; balance starts at 0 (the one write
      // to wallets outside postTransaction).
      await tx.wallet.create({ data: { userId, type: body.role } });
      await tx.userDocument.createMany({ data: documentRows(userId, objs.all) });
      await tx.kycSubmission.create({
        data: {
          userId,
          nidFrontId: objs.front.id,
          nidBackId: objs.back.id,
          selfieId: objs.selfie.id,
          ...(autoApproved && {
            status: 'APPROVED',
            reason: 'auto-approved',
            reviewedAt: new Date(),
          }),
        },
      });
      // Metadata is role + flag only: the NID and date of birth never go into audit_logs.
      await writeAudit(tx, {
        actorId: userId,
        action: 'REGISTERED',
        targetType: 'user',
        targetId: userId,
        metadata: { role: body.role, autoApproved },
        ip: meta.ip,
      });
      const refresh = await issueRefreshToken(tx, {
        userId,
        userAgent: meta.userAgent,
        ip: meta.ip,
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { kycSubmissions: true },
      });
      return { user, refresh };
    });
  } catch (err) {
    // 6. No account was committed, so nothing may point at these objects: delete them all.
    await deleteObjects(storage, objs.all);

    const index = violatedUniqueIndex(err);
    if (index === 'users_phone_key') throw phoneTaken();
    if (index === 'users_nid_number_key') throw nidTaken();
    throw err;
  }

  // Built after the try/catch: once the transaction has committed, the uploads belong to a
  // real account and must never be cleaned up, whatever happens next.
  return {
    user: toPublicUser(created.user, storage),
    accessToken: signAccessToken({ userId, role: created.user.role }),
    refresh: created.refresh,
  };
}
