import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/AppError';

const keySchema = z.uuid();

/** The client's `Idempotency-Key` header, a UUID → res.locals.idempotencyKey. Otherwise 400. */
export const requireIdempotencyKey: RequestHandler = (req, res, next) => {
  const key = keySchema.safeParse(req.get('idempotency-key'));
  if (!key.success) {
    next(
      new AppError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send an Idempotency-Key header with a new UUID for each transaction',
      ),
    );
    return;
  }
  res.locals.idempotencyKey = key.data;
  next();
};
