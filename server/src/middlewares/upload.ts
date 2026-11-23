import type { RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../utils/AppError';

// Memory storage: files stay in RAM as Buffers and are never written to disk unchecked.
const kycFields = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 3, fields: 10 },
}).fields([
  { name: 'nidFront', maxCount: 1 },
  { name: 'nidBack', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
]);

/** Parses the 3 KYC images from multipart/form-data. Missing files are checked in the controller. */
export const uploadKycImages: RequestHandler = (req, res, next) => {
  kycFields(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      next(
        err.code === 'LIMIT_FILE_SIZE'
          ? new AppError(413, 'FILE_TOO_LARGE', 'Each image must be 2 MB or smaller')
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
