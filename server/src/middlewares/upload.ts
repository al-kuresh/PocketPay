import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../utils/AppError';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Runs a multer handler and turns its errors into API errors (413 for size, 400 otherwise). */
const withUploadErrors =
  (parse: RequestHandler): RequestHandler =>
  (req, res, next) => {
    parse(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        next(
          err.code === 'LIMIT_FILE_SIZE'
            ? new AppError(413, 'FILE_TOO_LARGE', 'Each image must be 10 MB or smaller')
            : // Too many files, unknown field name, etc.: the client sent a malformed upload.
              new AppError(400, 'VALIDATION_ERROR', 'Invalid upload', {
                field: err.field,
                reason: err.code,
              }),
        );
        return;
      }
      next(err);
    });
  };

// Memory storage: files stay in RAM as Buffers and are never written to disk unchecked.

/** Parses the 3 KYC images from multipart/form-data. Missing files are checked in the controller. */
export const uploadKycImages = withUploadErrors(
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 3, fields: 10 },
  }).fields([
    { name: 'nidFront', maxCount: 1 },
    { name: 'nidBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
);

/** The 3 KYC images that uploadKycImages parsed. A missing one → 400 MISSING_FILE. */
export function kycImagesFrom(req: Request): Record<'nidFront' | 'nidBack' | 'selfie', Buffer> {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
  const image = (field: 'nidFront' | 'nidBack' | 'selfie') => {
    const file = files[field]?.[0];
    if (!file) throw new AppError(400, 'MISSING_FILE', `Please upload the ${field} image`, { field });
    return file.buffer;
  };
  return { nidFront: image('nidFront'), nidBack: image('nidBack'), selfie: image('selfie') };
}

/** Parses one `photo` image. A missing file is checked in the route. */
export const uploadProfilePhoto = withUploadErrors(
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
  }).single('photo'),
);
