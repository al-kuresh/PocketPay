import type { RequestHandler } from 'express';
import type { ZodError, ZodType } from 'zod';
import { AppError } from '../utils/AppError';

const validationError = (error: ZodError) =>
  new AppError(
    400,
    'VALIDATION_ERROR',
    'Invalid request',
    error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );

/** Validate `req.body` against `schema`; on success replace it with the parsed (trimmed, typed) data. */
export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(validationError(result.error));
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Validate `req.query` against `schema`; the parsed data goes on `res.locals.query`. */
export function validateQuery(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(validationError(result.error));
      return;
    }
    // Never req.query: in Express 5 it's a getter, so assigning to it throws.
    res.locals.query = result.data;
    next();
  };
}
