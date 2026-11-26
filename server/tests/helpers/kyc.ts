import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client';
import { prisma } from '../../src/lib/prisma';
import type { StorageProvider } from '../../src/lib/storage';

const KINDS = ['NID_FRONT', 'NID_BACK', 'SELFIE'] as const;

/**
 * A KYC submission (PENDING unless `data` says otherwise) with its 3 private documents, stored
 * under the same key shape as registration. The bytes are fake: tests only compare them.
 */
export async function createSubmission(
  storage: StorageProvider,
  userId: string,
  data: Partial<Prisma.KycSubmissionUncheckedCreateInput> = {},
) {
  const [front, back, selfie] = await Promise.all(
    KINDS.map(async (kind) => {
      const key = `kyc/${userId}/${kind.toLowerCase().replace('_', '-')}-${randomUUID()}.webp`;
      const body = Buffer.from(`RIFF fake ${kind} ${key}`);
      await storage.put({ key, body, contentType: 'image/webp', access: 'PRIVATE' });
      return prisma.userDocument.create({
        data: {
          userId,
          kind,
          storageKey: key,
          access: 'PRIVATE',
          mime: 'image/webp',
          sizeBytes: body.length,
          width: 1,
          height: 1,
        },
      });
    }),
  );
  return prisma.kycSubmission.create({
    data: { userId, nidFrontId: front!.id, nidBackId: back!.id, selfieId: selfie!.id, ...data },
  });
}
