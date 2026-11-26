import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { LocalStorage } from '../src/lib/storage/local';
import { MemoryStorage } from '../src/lib/storage/memory';

const SECRET = 'files-test-secret-that-is-at-least-32-characters';
const BYTES = Buffer.from('RIFF\0\0\0\0WEBPfake image bytes');

let root: string;
let storage: LocalStorage;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pocketpay-files-'));
  storage = new LocalStorage(root, SECRET);
  app = createApp({ storage });
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

const kycKey = () => `kyc/${randomUUID()}/nid-front-${randomUUID()}.webp`;

async function stored() {
  const key = kycKey();
  await storage.put({ key, body: BYTES, contentType: 'image/webp', access: 'PRIVATE' });
  return key;
}

/** Splits a signed link into its parts, so a test can change exactly one of them. */
function parts(url: string) {
  const u = new URL(url, 'http://x');
  return {
    key: u.pathname.replace('/api/v1/files/private/', ''),
    exp: u.searchParams.get('exp')!,
    sig: u.searchParams.get('sig')!,
  };
}
const link = (p: { key: string; exp: string; sig: string }) =>
  `/api/v1/files/private/${p.key}?exp=${p.exp}&sig=${p.sig}`;

/** Swap one character for the next one in the same alphabet, so the value stays well-formed. */
const flip = (s: string, i: number, alphabet: string) =>
  s.slice(0, i) + alphabet[(alphabet.indexOf(s[i]!) + 1) % alphabet.length] + s.slice(i + 1);

describe('LocalStorage.signedUrl', () => {
  it('builds /api/v1/files/private/<key>?exp=<unix s>&sig=<base64url HMAC-SHA256 of "key\\nexp">', async () => {
    const key = kycKey();
    const before = Math.floor(Date.now() / 1000);
    const p = parts(await storage.signedUrl(key, 300));

    expect(p.key).toBe(key);
    expect(Number(p.exp) - before).toBeGreaterThanOrEqual(300);
    expect(Number(p.exp) - before).toBeLessThanOrEqual(301);
    const expected = createHmac('sha256', SECRET).update(`${key}\n${p.exp}`).digest('base64url');
    expect(p.sig).toBe(expected);
  });

  it('refuses to sign without a secret', async () => {
    await expect(new LocalStorage(root).signedUrl(kycKey(), 300)).rejects.toThrow();
  });
});

describe('GET /api/v1/files/private/*key', () => {
  it('serves the bytes of a valid link with private, no-store headers', async () => {
    const key = await stored();

    const res = await request(app).get(await storage.signedUrl(key, 300));

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body)).toEqual(BYTES);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('works until exp and is 403 one second later', async () => {
    const key = await stored();
    const url = await storage.signedUrl(key, 300);
    const exp = Number(parts(url).exp);
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(exp * 1000);
    expect((await request(app).get(url)).status).toBe(200);

    vi.setSystemTime((exp + 1) * 1000);
    const res = await request(app).get(url);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LINK_EXPIRED_OR_INVALID');
  });

  it('is 403 when one character of sig, key or exp changes', async () => {
    const key = await stored();
    const other = await stored(); // a real file, so a changed key can't pass as "missing"
    const p = parts(await storage.signedUrl(key, 300));
    const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const hex = '0123456789abcdef';
    const keyHexAt = 'kyc/'.length; // first character of the user id

    const tampered = [
      { ...p, sig: flip(p.sig, 0, b64) },
      { ...p, sig: flip(p.sig, p.sig.length - 1, b64) },
      { ...p, sig: p.sig.slice(0, -1) },
      { ...p, key: flip(p.key, keyHexAt, hex) },
      { ...p, key: other },
      { ...p, exp: flip(p.exp, p.exp.length - 1, '0123456789') },
    ];
    for (const t of tampered) {
      const res = await request(app).get(link(t));
      expect(res.status, JSON.stringify(t)).toBe(403);
      expect(res.body.error.code).toBe('LINK_EXPIRED_OR_INVALID');
    }
  });

  it('is 403 without exp or sig, with exp or sig repeated, or with a non-integer exp', async () => {
    const key = await stored();
    const p = parts(await storage.signedUrl(key, 300));

    for (const url of [
      `/api/v1/files/private/${key}`,
      `/api/v1/files/private/${key}?exp=${p.exp}`,
      `/api/v1/files/private/${key}?sig=${p.sig}`,
      `/api/v1/files/private/${key}?exp=${p.exp}&sig=${p.sig}&sig=${p.sig}`,
      `/api/v1/files/private/${key}?exp=${p.exp}&exp=${p.exp}&sig=${p.sig}`,
      `/api/v1/files/private/${key}?exp=1e12&sig=${p.sig}`,
    ]) {
      expect((await request(app).get(url)).status, url).toBe(403);
    }
  });

  it('is 404 for a key outside kyc/ or with "..", even signed with the real secret', async () => {
    // A file that does exist in the private root, but not under kyc/.
    await storage.put({
      key: 'secret.webp',
      body: BYTES,
      contentType: 'image/webp',
      access: 'PRIVATE',
    });
    const u = randomUUID();
    const keys = [
      'secret.webp',
      `avatars/${u}/selfie-${u}.webp`,
      `kyc/${u}/../../secret.webp`,
      `kyc/${u}/%2e%2e/%2e%2e/secret.webp`,
      `kyc/../../../etc/passwd`,
      `kyc/${u}/selfie-${u}.png`,
      `kyc/${u}/selfie-${u}.webp/extra`,
    ];
    for (const key of keys) {
      // The key check must not depend on the signature.
      const exp = String(Math.floor(Date.now() / 1000) + 300);
      const sig = createHmac('sha256', SECRET).update(`${key}\n${exp}`).digest('base64url');
      const res = await request(app).get(link({ key, exp, sig })).buffer(true);
      expect(res.status, key).toBe(404);
      expect(
        Buffer.isBuffer(res.body) ? res.body : Buffer.from(JSON.stringify(res.body)),
      ).not.toEqual(BYTES);
    }
  });

  it('is 404 for a missing file with a valid signature', async () => {
    const res = await request(app).get(await storage.signedUrl(kycKey(), 300));
    expect(res.status).toBe(404);
  });

  it('is not mounted when the app uses another storage driver', async () => {
    const key = await stored();
    const res = await request(createApp({ storage: new MemoryStorage() })).get(
      await storage.signedUrl(key, 300),
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
