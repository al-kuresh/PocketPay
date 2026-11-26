import { Writable } from 'node:stream';
import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { httpLogger } from '../src/lib/httpLogger';

/** The real request logger, writing into memory, in front of a stub lookup route. */
function loggedApp() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const app = express();
  app.use(httpLogger(pino(sink)));
  app.get('/api/v1/wallets/lookup', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/v1/files/private/*key', (_req, res) => {
    res.json({ ok: true });
  });
  return { app, lines };
}

describe('httpLogger', () => {
  it('logs the path without the query string, so a looked-up phone never reaches the logs', async () => {
    const { app, lines } = loggedApp();

    await request(app)
      .get('/api/v1/wallets/lookup?phone=01700000000')
      .set('Authorization', 'Bearer secret-token');
    await vi.waitFor(() => expect(lines).toHaveLength(1));

    const output = lines.join('');
    expect(output).not.toContain('01700000000');
    expect(output).not.toContain('phone');
    const { req } = JSON.parse(lines[0]!);
    expect(req.method).toBe('GET');
    expect(req.url).toBe('/api/v1/wallets/lookup');
    expect(req).not.toHaveProperty('query');
    // The existing header redaction still holds.
    expect(req.headers.authorization).toBe('[REDACTED]');
    expect(output).not.toContain('secret-token');
  });

  it('logs a signed file link without its exp or sig', async () => {
    const { app, lines } = loggedApp();
    const path =
      '/api/v1/files/private/kyc/00000000-0000-4000-8000-000000000000/selfie-00000000-0000-4000-8000-000000000001.webp';

    await request(app).get(`${path}?exp=1900000000&sig=c2lnbmF0dXJlLXRoYXQtbXVzdC1ub3QtbGVhaw`);
    await vi.waitFor(() => expect(lines).toHaveLength(1));

    const output = lines.join('');
    expect(output).not.toContain('sig=');
    expect(output).not.toContain('c2lnbmF0dXJlLXRoYXQtbXVzdC1ub3QtbGVhaw');
    expect(output).not.toContain('1900000000');
    expect(JSON.parse(lines[0]!).req.url).toBe(path);
  });
});
