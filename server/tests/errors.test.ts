import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('body parsing errors', () => {
  it('malformed JSON returns 400 INVALID_JSON', async () => {
    const res = await request(createApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"amount":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: { code: 'INVALID_JSON', message: expect.any(String) } });
  });

  it('oversized JSON returns 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(createApp())
      .post('/api/v1/health')
      .send({ x: 'a'.repeat(200000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
