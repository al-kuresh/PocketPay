import type { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';

const BODY_ERRORS: Record<string, { status: number; code: string; message: string } | undefined> = {
  'entity.parse.failed': { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
  'entity.too.large': { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
};

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

  // body-parser (used by express.json) tags its errors with a `type` string.
  const bodyError = BODY_ERRORS[(err as { type?: string })?.type ?? ''];
  if (bodyError) {
    res.status(bodyError.status).json({
      success: false,
      error: { code: bodyError.code, message: bodyError.message },
    });
    return;
  }

  req.log?.error(err);
  const message =
    env.NODE_ENV === 'production' ? 'Something went wrong' : err instanceof Error ? err.message : String(err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
};
