import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { logger } from '../src/lib/logger';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { createActor } from './helpers/actors';
import { resetDb } from './helpers/db';

const PHONE = '01712345678';
const PIN = '48213';
const NEW_PIN = '73915';
const WRONG_PIN = '48214';

let app: ReturnType<typeof createApp>;
let userId: string;

beforeEach(async () => {
  await resetDb();
  app = createApp({ storage: new MemoryStorage() });
  ({
    user: { id: userId },
  } = await createActor({ phone: PHONE, nid: '1234567890', role: 'CUSTOMER', pin: PIN }));
});
afterAll(() => prisma.$disconnect());

/** The pp_rt value from a response's Set-Cookie header. */
function refreshCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return cookies.find((c) => c.startsWith('pp_rt='))!.split(';')[0]!.slice('pp_rt='.length);
}

const login = (pin: string, phone = PHONE) =>
  request(app).post('/api/v1/auth/login').send({ phone, pin });
const refresh = (cookie: string) =>
  request(app).post('/api/v1/auth/refresh').set('Cookie', `pp_rt=${cookie}`);

/** A real session: an access token and its refresh cookie. */
async function session(phone = PHONE) {
  const res = await login(PIN, phone);
  expect(res.status).toBe(200);
  return { accessToken: res.body.data.accessToken as string, cookie: refreshCookie(res) };
}

function changePin(
  body: { currentPin?: string; newPin?: string },
  auth?: { accessToken: string; cookie?: string },
) {
  let req = request(app).patch('/api/v1/auth/pin');
  if (auth) req = req.set('Authorization', `Bearer ${auth.accessToken}`);
  if (auth?.cookie) req = req.set('Cookie', `pp_rt=${auth.cookie}`);
  return req.send(body);
}

const audits = (action: string) => prisma.auditLog.findMany({ where: { action } });

describe('PATCH /auth/pin', () => {
  it('changes the PIN: 204, the new PIN logs in, the old one does not', async () => {
    const me = await session();

    const res = await changePin({ currentPin: PIN, newPin: NEW_PIN }, me);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await login(PIN)).status).toBe(401);
    expect((await login(NEW_PIN)).status).toBe(200);
  });

  it("revokes every other session but keeps the caller's own", async () => {
    const me = await session();
    const otherPhone = await session();
    const otherLaptop = await session();

    expect((await changePin({ currentPin: PIN, newPin: NEW_PIN }, me)).status).toBe(204);

    expect((await refresh(otherPhone.cookie)).status).toBe(401);
    expect((await refresh(otherLaptop.cookie)).status).toBe(401);
    expect((await refresh(me.cookie)).status).toBe(200);
  });

  it("does not touch another user's sessions", async () => {
    const me = await session();
    await createActor({ phone: '01812345678', nid: '1234567891', role: 'CUSTOMER', pin: PIN });
    const stranger = await session('01812345678');

    await changePin({ currentPin: PIN, newPin: NEW_PIN }, me);

    expect((await refresh(stranger.cookie)).status).toBe(200);
  });

  it("keeps no session when the cookie belongs to someone else", async () => {
    const me = await session();
    await createActor({ phone: '01812345678', nid: '1234567891', role: 'CUSTOMER', pin: PIN });
    const stranger = await session('01812345678');

    await changePin(
      { currentPin: PIN, newPin: NEW_PIN },
      { accessToken: me.accessToken, cookie: stranger.cookie },
    );

    expect((await refresh(me.cookie)).status).toBe(401);
    expect((await refresh(stranger.cookie)).status).toBe(200);
  });

  it('writes one PIN_CHANGED audit row', async () => {
    const me = await session();

    await changePin({ currentPin: PIN, newPin: NEW_PIN }, me);

    const rows = await audits('PIN_CHANGED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: userId, targetType: 'user', targetId: userId });
  });

  it('wrong current PIN → 403 INVALID_PIN on the shared lockout counter', async () => {
    const me = await session();

    const res = await changePin({ currentPin: WRONG_PIN, newPin: NEW_PIN }, me);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'INVALID_PIN', details: { attemptsLeft: 2 } });
    expect(await audits('PIN_CHANGE_FAILED')).toHaveLength(1);
    // The same counter as login: one more wrong change and one wrong login make 3 → locked.
    expect((await changePin({ currentPin: WRONG_PIN, newPin: NEW_PIN }, me)).status).toBe(403);
    expect((await login(WRONG_PIN)).status).toBe(423);
    expect(await audits('PIN_CHANGED')).toHaveLength(0);
  });

  it('a locked account → 423, even with the right current PIN', async () => {
    const me = await session();
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + 10 * 60_000) },
    });

    const res = await changePin({ currentPin: PIN, newPin: NEW_PIN }, me);

    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await audits('PIN_CHANGED')).toHaveLength(0);
  });

  it.each(['11111', '12345', '1234', 'abcde'])(
    'a weak or malformed new PIN (%s) → 400 VALIDATION_ERROR',
    async (newPin) => {
      const me = await session();

      const res = await changePin({ currentPin: PIN, newPin }, me);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('new PIN = current PIN → 422 PIN_UNCHANGED, and no session is revoked', async () => {
    const me = await session();
    const other = await session();

    const res = await changePin({ currentPin: PIN, newPin: PIN }, me);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PIN_UNCHANGED');
    expect((await refresh(other.cookie)).status).toBe(200);
    expect(await audits('PIN_CHANGED')).toHaveLength(0);
  });

  it('accepts Bangla digits (new = current in Bangla is still PIN_UNCHANGED)', async () => {
    const me = await session();

    // ৪৮২১৩ = 48213
    const res = await changePin({ currentPin: '৪৮২১৩', newPin: PIN }, me);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PIN_UNCHANGED');
  });

  it('no token → 401', async () => {
    const res = await changePin({ currentPin: PIN, newPin: NEW_PIN });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('never puts a PIN or a hash in a response, a log line or an audit row', async () => {
    const me = await session();
    const spies = (['debug', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(logger, level),
    );

    const responses = [
      await changePin({ currentPin: WRONG_PIN, newPin: NEW_PIN }, me),
      await changePin({ currentPin: PIN, newPin: '11111' }, me),
      await changePin({ currentPin: PIN, newPin: PIN }, me),
      await changePin({ currentPin: PIN, newPin: NEW_PIN }, me),
    ];

    const { pinHash } = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const seen = JSON.stringify([
      responses.map((r) => [r.text, r.headers]),
      spies.map((s) => s.mock.calls),
      await prisma.auditLog.findMany(),
    ]);
    for (const secret of [PIN, NEW_PIN, WRONG_PIN, '11111', pinHash]) {
      expect(seen).not.toContain(secret);
    }
    for (const s of spies) s.mockRestore();
  });
});
