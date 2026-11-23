import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Prisma } from '../src/generated/prisma/client';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { hashPin } from '../src/modules/auth/pin';
import { signRegistrationToken, verifyAccessToken } from '../src/modules/auth/tokens';
import { resetDb } from './helpers/db';

const PHONE = '01712345678';
const NID = '1234567890';
const PIN = '48213';
const WRONG_PIN = '48214';
const MINUTE = 60_000;

let pinHash: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  pinHash = await hashPin(PIN);
});
beforeEach(async () => {
  await resetDb();
  app = createApp({ storage: new MemoryStorage() });
});
afterAll(() => prisma.$disconnect());

/** Seed a user directly: login tests don't need to go through registration. */
const seedUser = (data: Partial<Prisma.UserCreateInput> = {}) =>
  prisma.user.create({
    data: {
      phone: PHONE,
      nidNumber: NID,
      name: 'Rahim Uddin',
      dateOfBirth: new Date('1995-06-15'),
      pinHash,
      role: 'CUSTOMER',
      ...data,
    },
  });

const login = (pin = PIN, phone = PHONE) =>
  request(app).post('/api/v1/auth/login').send({ phone, pin });
const refresh = (cookie?: string) => {
  const req = request(app).post('/api/v1/auth/refresh');
  return cookie === undefined ? req : req.set('Cookie', `pp_rt=${cookie}`);
};
const logout = (cookie?: string) => {
  const req = request(app).post('/api/v1/auth/logout');
  return cookie === undefined ? req : req.set('Cookie', `pp_rt=${cookie}`);
};

/** The pp_rt value from a response's Set-Cookie header ('' when it was cleared). */
function refreshCookie(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const pp = cookies.find((c) => c.startsWith('pp_rt='));
  return pp?.split(';')[0]?.slice('pp_rt='.length);
}

describe('POST /auth/login', () => {
  it('logs in a PENDING_KYC customer and starts a session', async () => {
    const user = await seedUser();

    const res = await login();

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      id: user.id,
      status: 'PENDING_KYC',
      nidMasked: '*******890',
      shopName: null,
    });
    expect(verifyAccessToken(res.body.data.accessToken)).toEqual({
      userId: user.id,
      role: 'CUSTOMER',
    });
    expect(refreshCookie(res)).toBeTruthy();
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_SUCCESS' } })).toBe(1);
  });

  it('lets a REJECTED user log in (to see why and resubmit)', async () => {
    await seedUser({ status: 'REJECTED' });
    expect((await login()).status).toBe(200);
  });

  it('counts wrong PINs and locks for 30 minutes on the 3rd', async () => {
    const user = await seedUser();

    const first = await login(WRONG_PIN);
    expect(first.status).toBe(401);
    expect(first.body.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      details: { attemptsLeft: 2 },
    });
    expect((await login(WRONG_PIN)).body.error.details).toEqual({ attemptsLeft: 1 });

    const third = await login(WRONG_PIN);
    expect(third.status).toBe(423);
    expect(third.body.error.code).toBe('ACCOUNT_LOCKED');
    const lockedFor = new Date(third.body.error.details.lockedUntil).getTime() - Date.now();
    expect(lockedFor).toBeGreaterThan(29 * MINUTE);
    expect(lockedFor).toBeLessThanOrEqual(30 * MINUTE);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedPinAttempts).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'ACCOUNT_LOCKED' } })).toBe(1);

    // Locked means locked: the right PIN doesn't help.
    const right = await login(PIN);
    expect(right.status).toBe(423);
    expect(right.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('allows login again once the lock has expired, and resets the counter', async () => {
    const user = await seedUser({
      lockedUntil: new Date(Date.now() - MINUTE),
      failedPinAttempts: 2,
    });

    const res = await login();

    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedPinAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it('answers an unknown phone exactly like a wrong PIN', async () => {
    await seedUser();
    const wrongPin = await login(WRONG_PIN);
    const unknown = await login(PIN, '01898765432');

    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrongPin.body.error.message);
  });

  it('refuses a FROZEN user even with the right PIN', async () => {
    await seedUser({ status: 'FROZEN' });

    const res = await login();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
    expect(refreshCookie(res)).toBeUndefined();
  });

  it('compares at most 3 PINs even when guesses arrive in parallel', async () => {
    const user = await seedUser();

    const results = await Promise.all(Array.from({ length: 10 }, () => login(WRONG_PIN)));

    // Exactly 3 attempts get to bcrypt: 2 answer "wrong PIN", the 3rd locks; the rest are 423.
    const codes = results.map((r) => r.body.error.code);
    expect(codes.filter((c) => c === 'INVALID_CREDENTIALS')).toHaveLength(2);
    expect(codes.filter((c) => c === 'ACCOUNT_LOCKED')).toHaveLength(8);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { action: { in: ['LOGIN_FAILED', 'ACCOUNT_LOCKED'] } },
      }),
    ).toBe(3);
  });

  it('rejects a malformed body with VALIDATION_ERROR', async () => {
    const res = await login('12');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the token; replaying the old one after 10 s revokes the whole family', async () => {
    await seedUser();
    const oldCookie = refreshCookie(await login())!;

    const rotated = await refresh(oldCookie);
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.user.nidMasked).toBe('*******890');
    expect(verifyAccessToken(rotated.body.data.accessToken).role).toBe('CUSTOMER');
    const newCookie = refreshCookie(rotated)!;
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toBe(oldCookie);

    // The old row is revoked and points at its replacement.
    const rows = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(rows[0]?.replacedById).toBe(rows[1]?.id);
    expect(rows[0]?.family).toBe(rows[1]?.family);

    // Pretend the rotation happened 11 s ago: past the grace window for concurrent refreshes.
    await prisma.refreshToken.update({
      where: { id: rows[0]!.id },
      data: { revokedAt: new Date(Date.now() - 11_000) },
    });

    // Someone replays the old token: refused and audited…
    const replay = await refresh(oldCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    expect(await prisma.auditLog.count({ where: { action: 'REFRESH_TOKEN_REUSE' } })).toBe(1);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    // …and the newest token in the family is dead too.
    expect((await refresh(newCookie)).status).toBe(401);
  });

  it('treats two refreshes at the same moment (two tabs) as benign', async () => {
    await seedUser();
    const cookie = refreshCookie(await login())!;

    const results = await Promise.all([refresh(cookie), refresh(cookie)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!;
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('REFRESH_IN_PROGRESS');
    // No Set-Cookie at all: clearing pp_rt here would log out the tab that just won.
    expect(loser.headers['set-cookie']).toBeUndefined();
    // The winner's new token still works: the family was not revoked.
    expect((await refresh(refreshCookie(winner)!)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'REFRESH_TOKEN_REUSE' } })).toBe(0);
  });

  it('answers a logged-out token with a plain 401, not a reuse alarm', async () => {
    await seedUser();
    const cookie = refreshCookie(await login())!;
    await logout(cookie);

    const res = await refresh(cookie);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    expect(await prisma.auditLog.count({ where: { action: 'REFRESH_TOKEN_REUSE' } })).toBe(0);
  });

  it('clears the refresh cookie when a refresh fails', async () => {
    const res = await refresh('not-a-token');

    expect(res.status).toBe(401);
    expect(refreshCookie(res)).toBe('');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('Path=/api/v1/auth');
    expect(setCookie).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('rejects a missing, unknown or expired token', async () => {
    await seedUser();
    const cookie = refreshCookie(await login())!;
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    // 'j:{…}' is a JSON cookie: cookie-parser turns it into an object, which must not crash.
    const jsonCookie = await refresh(`j:${encodeURIComponent('{"a":1}')}`);
    for (const res of [
      await refresh(),
      await refresh('not-a-token'),
      jsonCookie,
      await refresh(cookie),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    }
  });

  it('refuses to refresh a session once the user is frozen', async () => {
    const user = await seedUser();
    const cookie = refreshCookie(await login())!;
    await prisma.user.update({ where: { id: user.id }, data: { status: 'FROZEN' } });

    const res = await refresh(cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    await seedUser();
    const cookie = refreshCookie(await login())!;

    const res = await logout(cookie);

    expect(res.status).toBe(204);
    expect(refreshCookie(res)).toBe('');
    expect(String(res.headers['set-cookie'])).toContain('Path=/api/v1/auth');
    expect(await prisma.auditLog.count({ where: { action: 'LOGOUT' } })).toBe(1);
    expect((await refresh(cookie)).status).toBe(401);
  });

  it('succeeds without a cookie', async () => {
    expect((await logout()).status).toBe(204);
  });
});

describe('GET /me', () => {
  it('requires an access token', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a registration token used as an access token', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${signRegistrationToken({ phone: PHONE, otpId: user.id })}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the PublicUser for a valid access token', async () => {
    const user = await seedUser({ role: 'MERCHANT', shopName: 'Rahim Store' });
    const { accessToken } = (await login()).body.data;

    const res = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      id: user.id,
      role: 'MERCHANT',
      shopName: 'Rahim Store',
      nidMasked: '*******890',
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(NID);
    expect(body).not.toContain('pinHash');
    expect(body).not.toContain('dateOfBirth');
  });
});
