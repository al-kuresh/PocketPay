import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/AppError';

/** Validate `req.body` against `schema`; on success replace it with the parsed (trimmed, typed) data. */
export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request', details));
      return;
    }
    req.body = result.data;
    next();
  };
}
