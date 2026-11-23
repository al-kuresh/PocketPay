import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('health', () => {
  it('GET /api/v1/health returns ok', async () => {
    const res = await request(createApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(typeof res.body.data.uptime).toBe('number');
  });

  it('unknown route returns JSON 404', async () => {
    const res = await request(createApp()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});
