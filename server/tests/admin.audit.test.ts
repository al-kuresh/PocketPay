import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { LocalStorage } from '../src/lib/storage/local';
import { createActor } from './helpers/actors';
import { resetDb } from './helpers/db';
import { createSubmission } from './helpers/kyc';

const API = '/api/v1/admin/audit-logs';
const PIN = '48213';

let root: string;
let storage: LocalStorage;
let app: ReturnType<typeof createApp>;
let admin: Awaited<ReturnType<typeof createActor>>;
let customer: Awaited<ReturnType<typeof createActor>>;

beforeEach(async () => {
  await resetDb();
  root = await mkdtemp(path.join(tmpdir(), 'pocketpay-admin-audit-'));
  storage = new LocalStorage(root, 'admin-audit-test-secret-that-is-at-least-32-chars');
  app = createApp({ storage });
  admin = await createActor({ phone: '01900000001', nid: '1900000001', role: 'ADMIN', name: 'Admin One' });
  customer = await createActor({ phone: '01710000001', nid: '5550000001', role: 'CUSTOMER', name: 'Rahim Uddin', pin: PIN });
});
afterEach(() => rm(root, { recursive: true, force: true }));
afterAll(() => prisma.$disconnect());

const get = (url: string, token = admin.token) => request(app).get(url).set('Authorization', `Bearer ${token}`);
const ids = (res: request.Response) => res.body.data.items.map((i: { id: string }) => i.id);
const row = (action: string, createdAt: string, extra: { actorId?: string | null; targetId?: string } = {}) =>
  prisma.auditLog.create({
    data: {
      action,
      createdAt: new Date(createdAt),
      actorId: extra.actorId === null ? undefined : (extra.actorId ?? customer.user.id),
      targetType: 'user',
      targetId: extra.targetId ?? customer.user.id,
    },
  });

describe('GET /admin/audit-logs', () => {
  it('a non-admin gets 403 FORBIDDEN', async () => {
    const res = await get(API, customer.token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.data).toBeUndefined();
  });

  it('newest first, with the actor (or null) and every item field', async () => {
    const older = await row('LOGIN_SUCCESS', '2026-11-20T08:00:00Z');
    const system = await row('SOMETHING_SYSTEM', '2026-11-21T08:00:00Z', { actorId: null });
    const newest = await prisma.auditLog.create({
      data: {
        actorId: admin.user.id,
        action: 'USER_FROZEN',
        targetType: 'user',
        targetId: customer.user.id,
        metadata: { userId: customer.user.id, reason: 'Reported for fraud.' },
        ip: '127.0.0.1',
        createdAt: new Date('2026-11-22T08:00:00Z'),
      },
    });

    const res = await get(API);

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([newest.id, system.id, older.id]);
    expect(res.body.data.items[0]).toEqual({
      id: newest.id,
      createdAt: '2026-11-22T08:00:00.000Z',
      action: 'USER_FROZEN',
      actor: { id: admin.user.id, name: 'Admin One', role: 'ADMIN' },
      targetType: 'user',
      targetId: customer.user.id,
      metadata: { userId: customer.user.id, reason: 'Reported for fraud.' },
      ip: '127.0.0.1',
    });
    expect(res.body.data.items[1].actor).toBeNull();
    expect(res.body.data.nextCursor).toBeNull();
  });

  it('filters by actorId, targetId and action', async () => {
    const other = await createActor({ phone: '01710000002', nid: '5550000002', role: 'CUSTOMER' });
    const mine = await row('LOGIN_SUCCESS', '2026-11-20T08:00:00Z');
    const theirs = await row('LOGIN_SUCCESS', '2026-11-20T09:00:00Z', { actorId: other.user.id, targetId: other.user.id });
    const byAdmin = await row('USER_FROZEN', '2026-11-20T10:00:00Z', { actorId: admin.user.id });

    expect(ids(await get(`${API}?actorId=${other.user.id}`))).toEqual([theirs.id]);
    expect(ids(await get(`${API}?targetId=${customer.user.id}`))).toEqual([byAdmin.id, mine.id]);
    expect(ids(await get(`${API}?action=LOGIN_SUCCESS`))).toEqual([theirs.id, mine.id]);
    expect(ids(await get(`${API}?action=USER_FROZEN&actorId=${admin.user.id}`))).toEqual([byAdmin.id]);
    for (const bad of ['actorId=123', 'targetId=x', 'action=login', 'from=2026-02-30', 'limit=0', 'cursor=abc']) {
      expect((await get(`${API}?${bad}`)).status, bad).toBe(400);
    }
  });

  it('from/to are inclusive Asia/Dhaka days', async () => {
    // Dhaka is UTC+6: 2026-11-20T18:00Z is 00:00 on the 21st in Dhaka.
    const lastOf20 = await row('A_EVENT', '2026-11-20T17:59:59.999Z');
    const firstOf21 = await row('B_EVENT', '2026-11-20T18:00:00.000Z');
    const lastOf21 = await row('C_EVENT', '2026-11-21T17:59:59.999Z');
    const firstOf22 = await row('D_EVENT', '2026-11-21T18:00:00.000Z');

    expect(ids(await get(`${API}?from=2026-11-21&to=2026-11-21`))).toEqual([lastOf21.id, firstOf21.id]);
    expect(ids(await get(`${API}?from=2026-11-22`))).toEqual([firstOf22.id]);
    expect(ids(await get(`${API}?to=2026-11-20`))).toEqual([lastOf20.id]);
  });

  it('pages with nextCursor; ties on createdAt never repeat or skip', async () => {
    const made: string[] = [];
    for (let i = 0; i < 5; i++) made.push((await row('LOGIN_SUCCESS', i < 3 ? '2026-11-20T08:00:00Z' : `2026-11-2${i}T08:00:00Z`)).id);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(`${API}?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...ids(res));
      cursor = res.body.data.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen.slice(0, 2)).toEqual([made[4], made[3]]);
    expect(seen.slice(2)).toEqual(made.slice(0, 3).sort().reverse());
  });

  it('after real admin actions, no metadata holds an NID, PIN, token, storage key or URL', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ phone: customer.user.phone, pin: PIN });
    const accessToken = login.body.data.accessToken as string;
    const cookie = ([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('pp_rt='))!;
    const refreshToken = cookie.split(';')[0]!.slice('pp_rt='.length);
    await request(app).post('/api/v1/auth/login').send({ phone: customer.user.phone, pin: '48214' });

    const pendingUser = await createActor({ phone: '01710000003', nid: '5550000003', role: 'CUSTOMER', status: 'PENDING_KYC' });
    const s = await createSubmission(storage, pendingUser.user.id);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const detail = await request(app).get(`/api/v1/admin/kyc/${s.id}`).set(auth);
    await request(app).patch(`/api/v1/admin/kyc/${s.id}`).set(auth).send({ decision: 'REJECT', reason: 'The NID photo is blurry.' });
    await request(app).patch(`/api/v1/admin/users/${customer.user.id}/status`).set(auth).send({ action: 'FREEZE', reason: 'Reported for fraud.' });
    await request(app).patch(`/api/v1/admin/users/${customer.user.id}/status`).set(auth).send({ action: 'UNFREEZE', reason: 'Checked with the user.' });
    await prisma.user.update({ where: { id: customer.user.id }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    await request(app).post(`/api/v1/admin/users/${customer.user.id}/unlock`).set(auth);

    const res = await get(`${API}?limit=50`);

    const actions = res.body.data.items.map((i: { action: string }) => i.action).sort();
    expect(actions).toEqual(
      ['KYC_REJECTED', 'KYC_VIEWED', 'LOGIN_FAILED', 'LOGIN_SUCCESS', 'USER_FROZEN', 'USER_UNFROZEN', 'USER_UNLOCKED'].sort(),
    );
    // Ids are uuids (hex), which can contain any 5 digits by chance: strip them before looking for the PIN.
    const metadata = JSON.stringify(res.body.data.items.map((i: { metadata: unknown }) => i.metadata));
    const withoutIds = metadata.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
    for (const secret of [customer.user.nidNumber, pendingUser.user.nidNumber, accessToken, refreshToken, PIN, '48214']) {
      expect(withoutIds).not.toContain(secret);
    }
    for (const url of Object.values(detail.body.data.images as Record<string, string>)) expect(metadata).not.toContain(url);
    expect(metadata).not.toMatch(/https?:|\/api\/|sig=|kyc\/|pinHash|\$2[aby]\$/);
    expect(JSON.stringify(res.body)).not.toContain(customer.user.nidNumber);
  });
});
