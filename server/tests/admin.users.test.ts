import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Role, UserStatus } from '../src/generated/prisma/enums';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { createActor } from './helpers/actors';
import { resetDb } from './helpers/db';
import { createSubmission } from './helpers/kyc';

const API = '/api/v1/admin/users';
const PIN = '48213';
const WRONG_PIN = '48214';

let storage: MemoryStorage;
let app: ReturnType<typeof createApp>;
let admin: Awaited<ReturnType<typeof createActor>>;
let seq = 0;

beforeEach(async () => {
  await resetDb();
  storage = new MemoryStorage();
  app = createApp({ storage });
  admin = await createActor({ phone: '01900000001', nid: '3000000001', role: 'ADMIN', name: 'Admin One' });
});
afterAll(() => prisma.$disconnect());

/** A user with phone 0171000NNNN and NID 555000NNNN (no NID is a phone prefix). */
async function user(opts: { status?: UserStatus; role?: Exclude<Role, 'ADMIN'>; name?: string } = {}) {
  seq++;
  const n = String(seq).padStart(4, '0');
  return createActor({
    phone: `0171000${n}`,
    nid: `555000${n}`,
    role: opts.role ?? 'CUSTOMER',
    status: opts.status ?? 'ACTIVE',
    name: opts.name ?? 'Test User',
    pin: PIN,
  });
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (url: string, token = admin.token) => request(app).get(url).set(as(token));
const setStatus = (id: string, body: object, token = admin.token) =>
  request(app).patch(`${API}/${id}/status`).set(as(token)).send(body);
const unlock = (id: string, token = admin.token) => request(app).post(`${API}/${id}/unlock`).set(as(token));
const FREEZE = { action: 'FREEZE', reason: 'Reported for fraud.' };
const UNFREEZE = { action: 'UNFREEZE', reason: 'Checked with the user.' };

const login = (phone: string, pin = PIN) => request(app).post('/api/v1/auth/login').send({ phone, pin });
const refreshCookie = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('pp_rt='))!.split(';')[0]!;
const ids = (res: request.Response) => res.body.data.items.map((i: { id: string }) => i.id);
const statusOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).status;

describe('admin only', () => {
  it('a non-admin gets 403 FORBIDDEN on every users route, and nothing changes', async () => {
    const c = await user();
    const target = await user();
    for (const res of [
      await get(API, c.token),
      await get(`${API}/${target.user.id}`, c.token),
      await setStatus(target.user.id, FREEZE, c.token),
      await unlock(target.user.id, c.token),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: { code: 'FORBIDDEN', message: expect.any(String) } });
    }
    expect(await statusOf(target.user.id)).toBe('ACTIVE');
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe('GET /admin/users', () => {
  it('lists newest first with the list fields and a masked NID only', async () => {
    const a = await user({ name: 'Older One' });
    const b = await user({ name: 'Newer One', role: 'MERCHANT' });
    await prisma.user.update({ where: { id: a.user.id }, data: { createdAt: new Date('2026-11-01T00:00:00Z') } });
    await createSubmission(storage, b.user.id, { status: 'APPROVED' });

    const res = await get(`${API}?role=MERCHANT`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([
      {
        id: b.user.id,
        name: 'Newer One',
        phone: b.user.phone,
        role: 'MERCHANT',
        status: 'ACTIVE',
        shopName: null,
        nidMasked: `*******${b.user.nidNumber.slice(-3)}`,
        kycStatus: 'APPROVED',
        lockedUntil: null,
        createdAt: b.user.createdAt.toISOString(),
      },
    ]);
    const all = await get(API);
    expect(ids(all)).toEqual([b.user.id, admin.user.id, a.user.id]);
    for (const u of [a, b, admin]) expect(JSON.stringify(all.body)).not.toContain(u.user.nidNumber);
  });

  it('q: a phone prefix, a name (any case, contains) or an exact 10-digit NID', async () => {
    const rahim = await user({ name: 'Rahim Uddin' });
    const karim = await user({ name: 'Karim Hossain' });

    expect(ids(await get(`${API}?q=${rahim.user.phone}`))).toEqual([rahim.user.id]);
    expect(new Set(ids(await get(`${API}?q=0171000`)))).toEqual(new Set([rahim.user.id, karim.user.id]));
    expect(ids(await get(`${API}?q=rahim`))).toEqual([rahim.user.id]);
    expect(ids(await get(`${API}?q=OSSA`))).toEqual([karim.user.id]);
    expect(ids(await get(`${API}?q=${karim.user.nidNumber}`))).toEqual([karim.user.id]);
    // 9 digits of an NID: not a phone prefix, and NIDs only match in full.
    expect(ids(await get(`${API}?q=${karim.user.nidNumber.slice(0, 9)}`))).toEqual([]);
    expect(ids(await get(`${API}?q=nobody`))).toEqual([]);
  });

  it('filters by role and status, pages with nextCursor, and rejects bad filters', async () => {
    const frozen = [];
    for (let i = 0; i < 5; i++) frozen.push((await user({ status: 'FROZEN' })).user.id);
    await user({ status: 'ACTIVE', role: 'AGENT' });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(`${API}?status=FROZEN&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...ids(res));
      cursor = res.body.data.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([...frozen].reverse());

    expect((await get(`${API}?role=AGENT`)).body.data.items).toHaveLength(1);
    expect((await get(`${API}?status=SLEEPING`)).status).toBe(400);
    expect((await get(`${API}?cursor=abc`)).status).toBe(400);
  });
});

describe('GET /admin/users/:id', () => {
  it('adds the PIN counter, the balance as a string, the latest KYC and the last 10 audit rows', async () => {
    const c = await user({ status: 'PENDING_KYC' });
    await prisma.wallet.update({ where: { id: c.wallet!.id }, data: { balance: 123456n } });
    await prisma.user.update({ where: { id: c.user.id }, data: { failedPinAttempts: 2 } });
    await createSubmission(storage, c.user.id, { status: 'REJECTED', submittedAt: new Date('2026-11-01T00:00:00Z') });
    const latest = await createSubmission(storage, c.user.id);
    for (let i = 0; i < 12; i++) {
      await prisma.auditLog.create({
        data: { actorId: c.user.id, action: 'LOGIN_SUCCESS', targetType: 'user', targetId: c.user.id, createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)) },
      });
    }

    const res = await get(`${API}/${c.user.id}`);

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toMatchObject({
      id: c.user.id,
      status: 'PENDING_KYC',
      nidMasked: `*******${c.user.nidNumber.slice(-3)}`,
      kycStatus: 'PENDING',
      failedPinAttempts: 2,
      balance: '123456',
      latestKyc: { id: latest.id, status: 'PENDING' },
    });
    expect(d.recentAudit).toHaveLength(10);
    expect(d.recentAudit[0]).toEqual({
      id: expect.any(String),
      createdAt: '2026-11-01T00:11:00.000Z',
      action: 'LOGIN_SUCCESS',
      actor: { id: c.user.id, name: 'Test User', role: 'CUSTOMER' },
      targetType: 'user',
      targetId: c.user.id,
      metadata: null,
      ip: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(c.user.nidNumber);
  });

  it('an admin has no wallet: balance null; unknown id → 404 USER_NOT_FOUND', async () => {
    expect((await get(`${API}/${admin.user.id}`)).body.data).toMatchObject({ balance: null, latestKyc: null, kycStatus: null });
    const res = await get(`${API}/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });
});

describe('PATCH /admin/users/:id/status', () => {
  it('freeze ends the sessions: refresh is 401 and a money POST with a valid access token is ACCOUNT_NOT_ACTIVE', async () => {
    const c = await user();
    const loggedIn = await login(c.user.phone);
    expect(loggedIn.status).toBe(200);
    const cookie = refreshCookie(loggedIn);
    const accessToken = loggedIn.body.data.accessToken as string;

    const res = await setStatus(c.user.id, FREEZE);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: c.user.id, status: 'FROZEN' });
    expect(await statusOf(c.user.id)).toBe('FROZEN');
    expect(await prisma.refreshToken.count({ where: { userId: c.user.id, revokedAt: null } })).toBe(0);

    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(401);
    expect(refreshed.body.error.code).toBe('REFRESH_TOKEN_INVALID');

    const money = await request(app)
      .post('/api/v1/transactions/send-money')
      .set(as(accessToken))
      .set('Idempotency-Key', randomUUID())
      .send({ receiverPhone: '01710009999', amount: '10000', pin: PIN });
    expect(money.status).toBe(403);
    expect(money.body.error).toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE', details: { status: 'FROZEN' } });

    const [audit] = await prisma.auditLog.findMany({ where: { action: 'USER_FROZEN' } });
    expect(audit).toMatchObject({
      actorId: admin.user.id,
      targetType: 'user',
      targetId: c.user.id,
      metadata: { userId: c.user.id, reason: 'Reported for fraud.' },
    });
    expect((await login(c.user.phone)).body.error.code).toBe('ACCOUNT_FROZEN');
  });

  it('unfreeze → ACTIVE, audited, and login works again', async () => {
    const c = await user({ status: 'FROZEN' });

    const res = await setStatus(c.user.id, { action: 'UNFREEZE', reason: '  Checked with the user.  ' });

    expect(res.status).toBe(200);
    expect(await statusOf(c.user.id)).toBe('ACTIVE');
    const [audit] = await prisma.auditLog.findMany({ where: { action: 'USER_UNFROZEN' } });
    expect(audit?.metadata).toEqual({ userId: c.user.id, reason: 'Checked with the user.' });
    expect((await login(c.user.phone)).status).toBe(200);
  });

  it('only ACTIVE → FROZEN and FROZEN → ACTIVE; anything else → 409 USER_STATUS_CHANGED', async () => {
    for (const [status, body] of [
      ['PENDING_KYC', FREEZE],
      ['REJECTED', FREEZE],
      ['FROZEN', FREEZE],
      ['ACTIVE', UNFREEZE],
      ['PENDING_KYC', UNFREEZE],
    ] as const) {
      const c = await user({ status });
      const res = await setStatus(c.user.id, body);
      expect(res.status, `${body.action} from ${status}`).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'USER_STATUS_CHANGED', details: { status } });
      expect(await statusOf(c.user.id)).toBe(status);
    }
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('a reason is required (5–200 characters, trimmed); APPROVE is not an action here', async () => {
    const c = await user();
    for (const body of [
      { action: 'FREEZE' },
      { action: 'FREEZE', reason: ' abcd ' },
      { action: 'FREEZE', reason: 'x'.repeat(201) },
      { action: 'APPROVE', reason: 'Looks good to me.' },
    ]) {
      const res = await setStatus(c.user.id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await statusOf(c.user.id)).toBe('ACTIVE');
  });

  it('two freezes in parallel (10 rounds): one 200, one 409, one audit row', async () => {
    for (let round = 0; round < 10; round++) {
      const c = await user();
      const [a, b] = await Promise.all([setStatus(c.user.id, FREEZE), setStatus(c.user.id, FREEZE)]);
      expect([a.status, b.status].sort(), `round ${round}`).toEqual([200, 409]);
      expect(await statusOf(c.user.id)).toBe('FROZEN');
      expect(await prisma.auditLog.count({ where: { targetId: c.user.id, action: 'USER_FROZEN' } })).toBe(1);
    }
  });

  it('freeze and unfreeze in parallel on an ACTIVE user (10 rounds): the result is one of the serial orders', async () => {
    for (let round = 0; round < 10; round++) {
      const c = await user();

      const [f, u] = await Promise.all([setStatus(c.user.id, FREEZE), setStatus(c.user.id, UNFREEZE)]);

      // Unfreeze can only win after the freeze committed, so the outcomes are exactly:
      // freeze only (FROZEN), or freeze then unfreeze (ACTIVE). Never unfreeze alone.
      expect(f.status, `round ${round}`).toBe(200);
      const audits = await prisma.auditLog.findMany({
        where: { targetId: c.user.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (u.status === 200) {
        expect(await statusOf(c.user.id)).toBe('ACTIVE');
        expect(audits.map((x) => x.action)).toEqual(['USER_FROZEN', 'USER_UNFROZEN']);
      } else {
        expect(u.status).toBe(409);
        expect(await statusOf(c.user.id)).toBe('FROZEN');
        expect(audits.map((x) => x.action)).toEqual(['USER_FROZEN']);
      }
    }
  });

  it('an admin (another one, or the caller) → 422 CANNOT_MODIFY_ADMIN; unknown → 404', async () => {
    const other = await createActor({ phone: '01900000002', nid: '1900000002', role: 'ADMIN' });
    for (const target of [other, admin]) {
      const res = await setStatus(target.user.id, FREEZE);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('CANNOT_MODIFY_ADMIN');
      expect((await unlock(target.user.id)).body.error.code).toBe('CANNOT_MODIFY_ADMIN');
      expect(await statusOf(target.user.id)).toBe('ACTIVE');
    }
    expect((await setStatus(randomUUID(), FREEZE)).body.error.code).toBe('USER_NOT_FOUND');
    expect((await unlock(randomUUID())).status).toBe(404);
  });
});

describe('POST /admin/users/:id/unlock', () => {
  it('clears a real lockout: 3 wrong PINs, unlock, then login works; audited once', async () => {
    const c = await user();
    await login(c.user.phone, WRONG_PIN);
    await login(c.user.phone, WRONG_PIN);
    expect((await login(c.user.phone, WRONG_PIN)).status).toBe(423);
    expect((await login(c.user.phone)).status).toBe(423);

    const res = await unlock(c.user.id);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: c.user.id, unlocked: true });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } })).toMatchObject({
      failedPinAttempts: 0,
      lockedUntil: null,
    });
    expect((await login(c.user.phone)).status).toBe(200);
    const [audit] = await prisma.auditLog.findMany({ where: { action: 'USER_UNLOCKED' } });
    expect(audit).toMatchObject({ actorId: admin.user.id, targetId: c.user.id, metadata: { userId: c.user.id } });
  });

  it('not locked (or an expired lock) → 200 with no change and no audit row', async () => {
    const c = await user();
    await prisma.user.update({ where: { id: c.user.id }, data: { failedPinAttempts: 1 } });
    const expired = await user();
    await prisma.user.update({ where: { id: expired.user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });

    for (const u of [c, expired]) {
      const res = await unlock(u.user.id);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id: u.user.id, unlocked: false });
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } })).failedPinAttempts).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'USER_UNLOCKED' } })).toBe(0);
  });
});
