import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { createLimiter } from '../../src/middlewares/rateLimit';

describe('createLimiter', () => {
  it('answers over-limit requests with 429 RATE_LIMITED in the API error shape', async () => {
    // skip: () => false forces the limiter on; the real limiters are skipped when NODE_ENV=test.
    const app = express();
    app.get('/x', createLimiter({ windowMs: 60_000, limit: 1, skip: () => false }), (_req, res) => {
      res.json({ success: true });
    });
    app.use(errorHandler);

    expect((await request(app).get('/x')).status).toBe(200);
    const limited = await request(app).get('/x');

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      success: false,
      error: { code: 'RATE_LIMITED', message: expect.any(String) },
    });
    // draft-8 standard headers: RateLimit-Policy + RateLimit; no legacy X-RateLimit-*.
    expect(limited.headers['ratelimit-policy']).toBeDefined();
    expect(limited.headers['x-ratelimit-limit']).toBeUndefined();
  });
});
