import { randomUUID } from 'node:crypto';
import { processImage } from '../../lib/images';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import type { StorageProvider } from '../../lib/storage';
import { AppError } from '../../utils/AppError';
import { accountFrozen } from '../auth/refresh.service';
import { toPublicUser, type PublicUser } from '../auth/user.presenter';

/**
 * Replace the user's public profile photo. Only PROFILE / PUBLIC data is ever written or
 * deleted here: the private NID and selfie documents are never read or touched.
 */
export async function changeProfilePhoto(input: {
  userId: string;
  image: Buffer;
  storage: StorageProvider;
}): Promise<PublicUser> {
  const { userId, image, storage } = input;
  // The access token is stateless (up to 15 min): re-read the status before any work.
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!owner) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in again');
  if (owner.status === 'FROZEN') throw accountFrozen();

  // The Phase 3 pipeline: real-type check, .rotate(), EXIF stripped, 512×512 WebP.
  const avatar = await processImage(image, { mode: 'avatar' });
  const key = `profile/${userId}/${randomUUID()}.webp`;
  try {
    await storage.put({ key, body: avatar.data, contentType: avatar.mime, access: 'PUBLIC' });
  } catch (err) {
    logger.error({ key, err: err instanceof Error ? err.message : String(err) }, 'Upload failed');
    throw new AppError(502, 'UPLOAD_FAILED', 'Could not save your photo. Please try again');
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Row lock: of two parallel uploads, the second sees the first's key as the old one,
      // so no uploaded photo is left without a pointer to it.
      const [row] = await tx.$queryRaw<{ profile_photo_key: string | null }[]>`
        SELECT profile_photo_key FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
      if (!row) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in again');
      const oldKey = row.profile_photo_key;

      await tx.userDocument.create({
        data: {
          userId,
          kind: 'PROFILE',
          storageKey: key,
          access: 'PUBLIC',
          mime: avatar.mime,
          sizeBytes: avatar.sizeBytes,
          width: avatar.width,
          height: avatar.height,
        },
      });
      // The old PROFILE row would point at an object deleted below.
      if (oldKey) {
        await tx.userDocument.deleteMany({
          where: { userId, kind: 'PROFILE', storageKey: oldKey },
        });
      }
      const user = await tx.user.update({
        where: { id: userId },
        data: { profilePhotoKey: key },
        include: { kycSubmissions: true },
      });
      return { user, oldKey };
    });
  } catch (err) {
    // Nothing points at the new object: remove it. Best effort, logged by key only.
    await storage.delete(key, 'PUBLIC').catch(() => logger.warn({ key }, 'Upload cleanup failed'));
    throw err;
  }

  // After the commit: a failed delete leaves an orphan to clean up, never a failed request.
  if (result.oldKey) {
    const oldKey = result.oldKey;
    await storage
      .delete(oldKey, 'PUBLIC')
      .catch(() => logger.warn({ key: oldKey }, 'Old profile photo delete failed'));
  }
  return toPublicUser(result.user, storage);
}
