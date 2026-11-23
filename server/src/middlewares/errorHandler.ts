import type { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';

// Express recognises an error handler by its 4 parameters, so `_next` must stay.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  req.log?.error(err);
  const message =
    env.NODE_ENV === 'production' ? 'Something went wrong' : err instanceof Error ? err.message : String(err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
};
