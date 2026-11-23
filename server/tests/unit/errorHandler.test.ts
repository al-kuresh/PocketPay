import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/lib/logger';
import { errorHandler } from '../../src/middlewares/errorHandler';

/** Minimal Express response that records what the handler sent. */
function fakeRes() {
  const res = { statusCode: 0, body: undefined as unknown };
  return Object.assign(res, {
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    json(body: unknown) {
      res.body = body;
      return this;
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('errorHandler with Prisma errors', () => {
  it('never logs or returns the message, which can contain query values', () => {
    const error = Object.assign(
      new Error('Invalid `prisma.user.create()` invocation: { nidNumber: "1234567890" }'),
      { name: 'PrismaClientValidationError' },
    );
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = fakeRes();

    errorHandler(error, {} as Request, res as unknown as Response, (() => {}) as NextFunction);

    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toContain('1234567890');
    expect(logged.mock.calls[0]?.[0]).toMatchObject({ name: 'PrismaClientValidationError' });

    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('1234567890');
  });
});
