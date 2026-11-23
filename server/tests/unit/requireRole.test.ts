import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requireRole } from '../../src/middlewares/auth';
import { AppError } from '../../src/utils/AppError';

describe('requireRole', () => {
  it('passes a 403 FORBIDDEN AppError to next when the role is not allowed', () => {
    const next = vi.fn();
    const req = { user: { id: 'u1', role: 'CUSTOMER' } } as Request;

    requireRole('ADMIN')(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('calls next with no error when the role is allowed', () => {
    const next = vi.fn();
    const req = { user: { id: 'u1', role: 'ADMIN' } } as Request;

    requireRole('ADMIN')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});
