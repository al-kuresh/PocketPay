import { randomUUID } from 'node:crypto';
import type { DocumentAccess, DocumentKind } from '../../generated/prisma/enums';
import { processImage, type ProcessedImage } from '../../lib/images';
import { logger } from '../../lib/logger';
import type { StorageProvider } from '../../lib/storage';
import { AppError } from '../../utils/AppError';

export interface KycImages {
  nidFront: Buffer;
  nidBack: Buffer;
  selfie: Buffer;
}

export interface KycObject {
  id: string;
  kind: DocumentKind;
  access: DocumentAccess;
  image: ProcessedImage;
  key: string;
}

/**
 * Checks and re-encodes the 3 KYC images and the selfie's avatar copy (415 on a bad file), and
 * gives each object its document id and storage key up front. Only these WebP outputs are
 * stored; the original uploads (with their EXIF) never leave this function.
 */
export async function prepareKycObjects(userId: string, images: KycImages) {
  const [nidFront, nidBack, selfie, avatar] = await Promise.all([
    processImage(images.nidFront, { mode: 'document' }),
    processImage(images.nidBack, { mode: 'document' }),
    processImage(images.selfie, { mode: 'document' }),
    processImage(images.selfie, { mode: 'avatar' }),
  ]);
  const doc = (kind: DocumentKind, access: DocumentAccess, image: ProcessedImage, key: string): KycObject => ({
    id: randomUUID(),
    kind,
    access,
    image,
    key,
  });
  const front = doc('NID_FRONT', 'PRIVATE', nidFront, `kyc/${userId}/nid-front-${randomUUID()}.webp`);
  const back = doc('NID_BACK', 'PRIVATE', nidBack, `kyc/${userId}/nid-back-${randomUUID()}.webp`);
  const selfieDoc = doc('SELFIE', 'PRIVATE', selfie, `kyc/${userId}/selfie-${randomUUID()}.webp`);
  const profile = doc('PROFILE', 'PUBLIC', avatar, `profile/${userId}/${randomUUID()}.webp`);
  return { front, back, selfie: selfieDoc, profile, all: [front, back, selfieDoc, profile] };
}

/** The user_documents rows for `objects`. */
export const documentRows = (userId: string, objects: KycObject[]) =>
  objects.map((o) => ({
    id: o.id,
    userId,
    kind: o.kind,
    storageKey: o.key,
    access: o.access,
    mime: o.image.mime,
    sizeBytes: o.image.sizeBytes,
    width: o.image.width,
    height: o.image.height,
  }));

/**
 * Best-effort delete: a failed delete must not hide the caller's error, but it is logged (kind
 * and access only: no storage key, which names the user) so the orphan can be found.
 */
export async function deleteObjects(storage: StorageProvider, objects: KycObject[]) {
  await Promise.all(
    objects.map(async (o) => {
      try {
        await storage.delete(o.key, o.access);
      } catch {
        logger.warn({ kind: o.kind, access: o.access }, 'Upload cleanup failed');
      }
    }),
  );
}

/** Uploads every object. If any fails, deletes the ones that made it and throws 502 UPLOAD_FAILED. */
export async function uploadObjects(storage: StorageProvider, objects: KycObject[]) {
  const uploaded: KycObject[] = [];
  const succeeded = await Promise.all(
    objects.map(async (o) => {
      try {
        await storage.put({ key: o.key, body: o.image.data, contentType: o.image.mime, access: o.access });
        uploaded.push(o);
        return true;
      } catch (err) {
        // The storage error says what went wrong; the kind says which object. No user data.
        logger.error(
          { kind: o.kind, access: o.access, err: err instanceof Error ? err.message : String(err) },
          'Upload failed',
        );
        return false;
      }
    }),
  );
  if (succeeded.includes(false)) {
    await deleteObjects(storage, uploaded);
    throw new AppError(502, 'UPLOAD_FAILED', 'Could not save your photos. Please try again');
  }
}
