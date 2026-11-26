import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { UserStatus } from '../src/generated/prisma/enums';
import { prisma } from '../src/lib/prisma';
import { LocalStorage } from '../src/lib/storage/local';
import { createActor } from './helpers/actors';
import { resetDb } from './helpers/db';
import { createSubmission } from './helpers/kyc';

const SECRET = 'admin-kyc-test-secret-that-is-at-least-32-chars';
const API = '/api/v1/admin/kyc';

let root: string;
let storage: LocalStorage;
let app: ReturnType<typeof createApp>;
let admin: Awaited<ReturnType<typeof createActor>>;
let phoneSeq = 0;

beforeEach(async () => {
  await resetDb();
  root = await mkdtemp(path.join(tmpdir(), 'pocketpay-admin-kyc-'));
  storage = new LocalStorage(root, SECRET);
  app = createApp({ storage });
  admin = await createActor({ phone: '01900000001', nid: '1900000001', role: 'ADMIN', name: 'Admin One' });
});
afterEach(() => rm(root, { recursive: true, force: true }));
afterAll(() => prisma.$disconnect());

/** A fresh customer (PENDING_KYC by default) with a fake NID ending in its sequence number. */
async function customer(status: UserStatus = 'PENDING_KYC', name = 'Rahim Uddin') {
  phoneSeq++;
  const n = String(phoneSeq).padStart(4, '0');
  return createActor({ phone: `0171000${n}`, nid: `900000${n}`, role: 'CUSTOMER', status, name });
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (url: string, token = admin.token) => request(app).get(url).set(as(token));
const review = (id: string, body: object, token = admin.token) =>
  request(app).patch(`${API}/${id}`).set(as(token)).send(body);
const APPROVE = { decision: 'APPROVE' };
const REJECT = { decision: 'REJECT', reason: 'The NID photo is blurry.' };

describe('admin only', () => {
  it('a non-admin gets 403 FORBIDDEN on all three, with no admin data', async () => {
    const c = await customer('ACTIVE');
    const s = await createSubmission(storage, c.user.id);

    for (const res of [
      await get(API, c.token),
      await get(`${API}/${s.id}`, c.token),
      await review(s.id, APPROVE, c.token),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: { code: 'FORBIDDEN', message: expect.any(String) } });
    }
    expect(await prisma.kycSubmission.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: 'PENDING' });
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('no token → 401', async () => {
    expect((await request(app).get(API)).status).toBe(401);
  });
});

describe('GET /admin/kyc', () => {
  const at = (iso: string) => new Date(iso);

  it('defaults to PENDING, oldest first, with pendingCount and masked NIDs only', async () => {
    const a = await customer('PENDING_KYC', 'Older Person');
    const b = await customer('PENDING_KYC', 'Newer Person');
    const c = await customer('ACTIVE');
    const newer = await createSubmission(storage, b.user.id, { submittedAt: at('2026-11-20T10:00:00Z') });
    const older = await createSubmission(storage, a.user.id, { submittedAt: at('2026-11-19T10:00:00Z') });
    await createSubmission(storage, c.user.id, { status: 'APPROVED', reviewedAt: new Date() });

    const res = await get(API);

    expect(res.status).toBe(200);
    expect(res.body.data.pendingCount).toBe(2);
    expect(res.body.data.nextCursor).toBeNull();
    expect(res.body.data.items).toEqual([
      {
        id: older.id,
        submittedAt: '2026-11-19T10:00:00.000Z',
        status: 'PENDING',
        user: {
          id: a.user.id,
          name: 'Older Person',
          phone: a.user.phone,
          role: 'CUSTOMER',
          shopName: null,
          nidMasked: `*******${a.user.nidNumber.slice(-3)}`,
        },
      },
      expect.objectContaining({ id: newer.id }),
    ]);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(a.user.nidNumber);
    expect(body).not.toContain(b.user.nidNumber);
  });

  it('filters by status, newest first for APPROVED and REJECTED', async () => {
    const ids: string[] = [];
    for (const day of ['17', '19', '18']) {
      const c = await customer('ACTIVE');
      const s = await createSubmission(storage, c.user.id, {
        status: 'APPROVED',
        submittedAt: at(`2026-11-${day}T10:00:00Z`),
      });
      ids.push(s.id);
    }
    const r = await customer('REJECTED');
    const rejected = await createSubmission(storage, r.user.id, { status: 'REJECTED', reason: 'blurry photo' });

    const approved = await get(`${API}?status=APPROVED`);
    expect(approved.body.data.items.map((i: { id: string }) => i.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(approved.body.data.pendingCount).toBe(0);

    const rej = await get(`${API}?status=REJECTED`);
    expect(rej.body.data.items.map((i: { id: string }) => i.id)).toEqual([rejected.id]);

    expect((await get(`${API}?status=FROZEN`)).status).toBe(400);
  });

  it('pages with nextCursor, ties on submittedAt broken by id, no repeats or gaps', async () => {
    const same = at('2026-11-20T10:00:00Z');
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await customer();
      created.push((await createSubmission(storage, c.user.id, { submittedAt: i < 3 ? same : at(`2026-11-2${i}T10:00:00Z`) })).id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(`${API}?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.items.map((i: { id: string }) => i.id));
      cursor = res.body.data.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...created].sort());
    // Oldest first; the 3 with the same time in id order.
    expect(seen.slice(0, 3)).toEqual(created.slice(0, 3).sort());
    expect((await get(`${API}?cursor=not-a-cursor`)).status).toBe(400);
  });

  it('a cursor whose submission left the filter (reviewed meanwhile) still drops nothing', async () => {
    const subs = [];
    for (let i = 0; i < 4; i++) {
      const c = await customer();
      subs.push(await createSubmission(storage, c.user.id, { submittedAt: at(`2026-11-1${i}T10:00:00Z`) }));
    }
    const first = await get(`${API}?limit=2`);
    expect(first.body.data.items.map((i: { id: string }) => i.id)).toEqual([subs[0]!.id, subs[1]!.id]);
    // Another admin approves the cursor row before the next page is loaded.
    await review(subs[1]!.id, APPROVE);

    const next = await get(`${API}?limit=2&cursor=${first.body.data.nextCursor}`);
    expect(next.body.data.items.map((i: { id: string }) => i.id)).toEqual([subs[2]!.id, subs[3]!.id]);
  });
});

describe('GET /admin/kyc/:id', () => {
  it('has the full NID, signed links that work, no-store, and one KYC_VIEWED row', async () => {
    const c = await customer('PENDING_KYC', 'Jamal Uddin');
    const old = await createSubmission(storage, c.user.id, {
      status: 'REJECTED',
      reason: 'The NID photo is blurry.',
      submittedAt: new Date('2026-11-01T10:00:00Z'),
      reviewedAt: new Date('2026-11-02T10:00:00Z'),
      reviewedById: admin.user.id,
    });
    const s = await createSubmission(storage, c.user.id);

    const res = await get(`${API}/${s.id}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const d = res.body.data;
    expect(d).toMatchObject({
      id: s.id,
      status: 'PENDING',
      submittedAt: s.submittedAt.toISOString(),
      reviewedAt: null,
      reason: null,
      reviewedBy: null,
      isLatest: true,
      user: {
        id: c.user.id,
        name: 'Jamal Uddin',
        phone: c.user.phone,
        role: 'CUSTOMER',
        shopName: null,
        dateOfBirth: '1995-06-15',
        nidNumber: c.user.nidNumber,
        status: 'PENDING_KYC',
      },
      history: [{ id: old.id, status: 'REJECTED', submittedAt: '2026-11-01T10:00:00.000Z', reason: 'The NID photo is blurry.' }],
    });
    expect(Object.keys(d.user).sort()).toEqual(
      ['dateOfBirth', 'id', 'name', 'nidNumber', 'phone', 'role', 'shopName', 'status'].sort(),
    );

    // Each link is a 5-minute signed link that the files route serves.
    const docs = await prisma.kycSubmission.findUniqueOrThrow({
      where: { id: s.id },
      include: { nidFront: true, nidBack: true, selfie: true },
    });
    const now = Math.floor(Date.now() / 1000);
    for (const [field, doc] of [
      ['nidFront', docs.nidFront],
      ['nidBack', docs.nidBack],
      ['selfie', docs.selfie],
    ] as const) {
      const url = new URL(d.images[field], 'http://x');
      expect(url.pathname).toBe(`/api/v1/files/private/${doc.storageKey}`);
      expect(Number(url.searchParams.get('exp')) - now).toBeGreaterThanOrEqual(299);
      expect(Number(url.searchParams.get('exp')) - now).toBeLessThanOrEqual(301);
      const img = await request(app).get(d.images[field]);
      expect(img.status).toBe(200);
      expect(Buffer.from(img.body)).toEqual(await readFile(path.join(root, 'private', doc.storageKey)));
    }

    const audits = await prisma.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: admin.user.id,
      action: 'KYC_VIEWED',
      targetType: 'user',
      targetId: c.user.id,
      metadata: { submissionId: s.id, userId: c.user.id },
    });
  });

  it('an older submission: isLatest false, with the reviewer', async () => {
    const c = await customer('PENDING_KYC');
    const old = await createSubmission(storage, c.user.id, {
      status: 'REJECTED',
      reason: 'blurry photo',
      submittedAt: new Date('2026-11-01T10:00:00Z'),
      reviewedAt: new Date('2026-11-02T10:00:00Z'),
      reviewedById: admin.user.id,
    });
    await createSubmission(storage, c.user.id);

    const d = (await get(`${API}/${old.id}`)).body.data;
    expect(d).toMatchObject({
      isLatest: false,
      reviewedBy: { id: admin.user.id, name: 'Admin One' },
      reviewedAt: '2026-11-02T10:00:00.000Z',
      reason: 'blurry photo',
    });
  });

  it('an unknown id → 404 KYC_NOT_FOUND, a non-uuid → 400, and no audit row', async () => {
    const res = await get(`${API}/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('KYC_NOT_FOUND');
    expect((await get(`${API}/123`)).status).toBe(400);
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe('PATCH /admin/kyc/:id', () => {
  it('approve: submission APPROVED by this admin, user ACTIVE, KYC_APPROVED audit', async () => {
    const c = await customer();
    const s = await createSubmission(storage, c.user.id);

    const res = await review(s.id, APPROVE);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: s.id, status: 'APPROVED', reason: null, user: { id: c.user.id, status: 'ACTIVE' } });
    const row = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ status: 'APPROVED', reviewedById: admin.user.id, reason: null });
    expect(row.reviewedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } })).status).toBe('ACTIVE');
    const audits = await prisma.auditLog.findMany({ where: { action: 'KYC_APPROVED' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: admin.user.id,
      targetType: 'user',
      targetId: c.user.id,
      metadata: { submissionId: s.id, userId: c.user.id },
    });
  });

  it('reject: the trimmed reason on the row and in the audit, user REJECTED', async () => {
    const c = await customer();
    const s = await createSubmission(storage, c.user.id);

    const res = await review(s.id, { decision: 'REJECT', reason: '  The NID photo is blurry.  ' });

    expect(res.status).toBe(200);
    expect(await prisma.kycSubmission.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
      status: 'REJECTED',
      reviewedById: admin.user.id,
      reason: 'The NID photo is blurry.',
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } })).status).toBe('REJECTED');
    const [audit] = await prisma.auditLog.findMany({ where: { action: 'KYC_REJECTED' } });
    expect(audit?.metadata).toEqual({ submissionId: s.id, userId: c.user.id, reason: 'The NID photo is blurry.' });
  });

  it('reject without a reason, with 4 characters (after trim) or 201 → 400, nothing changes', async () => {
    const c = await customer();
    const s = await createSubmission(storage, c.user.id);

    for (const body of [
      { decision: 'REJECT' },
      { decision: 'REJECT', reason: '  abcd  ' },
      { decision: 'REJECT', reason: 'x'.repeat(201) },
      { decision: 'MAYBE' },
      {},
    ]) {
      const res = await review(s.id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await prisma.kycSubmission.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('PENDING');
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('reviewing twice → 409 KYC_ALREADY_REVIEWED, the first decision stays', async () => {
    const c = await customer();
    const s = await createSubmission(storage, c.user.id);
    expect((await review(s.id, APPROVE)).status).toBe(200);

    const again = await review(s.id, REJECT);

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('KYC_ALREADY_REVIEWED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } })).status).toBe('ACTIVE');
    expect(await prisma.auditLog.count({ where: { action: { in: ['KYC_APPROVED', 'KYC_REJECTED'] } } })).toBe(1);
  });

  it('approve and reject in parallel (10 rounds): one 200, one 409, the status matches the winner', async () => {
    for (let round = 0; round < 10; round++) {
      const c = await customer();
      const s = await createSubmission(storage, c.user.id);
      const second = await createActor({
        phone: `0190000${String(100 + round).padStart(4, '0')}`,
        nid: `19000${String(10000 + round)}`,
        role: 'ADMIN',
      });

      const [a, r] = await Promise.all([review(s.id, APPROVE), review(s.id, REJECT, second.token)]);

      const statuses = [a.status, r.status].sort();
      expect(statuses, `round ${round}`).toEqual([200, 409]);
      const loser = a.status === 409 ? a : r;
      expect(loser.body.error.code).toBe('KYC_ALREADY_REVIEWED');
      const approved = a.status === 200;
      const sub = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: s.id } });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } });
      expect(sub.status).toBe(approved ? 'APPROVED' : 'REJECTED');
      expect(sub.reviewedById).toBe(approved ? admin.user.id : second.user.id);
      expect(user.status).toBe(approved ? 'ACTIVE' : 'REJECTED');
      const audits = await prisma.auditLog.findMany({
        where: { targetId: c.user.id, action: { in: ['KYC_APPROVED', 'KYC_REJECTED'] } },
      });
      expect(audits.map((x) => x.action)).toEqual([approved ? 'KYC_APPROVED' : 'KYC_REJECTED']);
    }
  });

  it('a submission that is no longer the latest → 409 KYC_NOT_LATEST, nothing changes', async () => {
    const c = await customer();
    const old = await createSubmission(storage, c.user.id, { submittedAt: new Date('2026-11-01T10:00:00Z') });
    await createSubmission(storage, c.user.id);

    const res = await review(old.id, APPROVE);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('KYC_NOT_LATEST');
    expect((await prisma.kycSubmission.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('PENDING');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } })).status).toBe('PENDING_KYC');
  });

  it('the old, reviewed submission after a resubmit → 409, the new one is untouched', async () => {
    const c = await customer();
    const old = await createSubmission(storage, c.user.id, {
      status: 'REJECTED',
      reason: 'blurry photo',
      submittedAt: new Date('2026-11-01T10:00:00Z'),
      reviewedAt: new Date('2026-11-02T10:00:00Z'),
    });
    const fresh = await createSubmission(storage, c.user.id);

    const res = await review(old.id, APPROVE);

    expect(res.status).toBe(409);
    expect(['KYC_ALREADY_REVIEWED', 'KYC_NOT_LATEST']).toContain(res.body.error.code);
    expect((await prisma.kycSubmission.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('PENDING');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } })).status).toBe('PENDING_KYC');
  });

  it('a user frozen while the page was open → 409 USER_STATUS_CHANGED, still FROZEN', async () => {
    const c = await customer();
    const s = await createSubmission(storage, c.user.id);
    await prisma.user.update({ where: { id: c.user.id }, data: { status: 'FROZEN' } });

    const res = await review(s.id, APPROVE);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USER_STATUS_CHANGED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } })).status).toBe('FROZEN');
    expect((await prisma.kycSubmission.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('PENDING');
  });

  it("an admin's own submission, or another admin's → 422 CANNOT_MODIFY_ADMIN", async () => {
    const other = await createActor({ phone: '01900000002', nid: '1900000002', role: 'ADMIN' });
    for (const target of [admin, other]) {
      await prisma.user.update({ where: { id: target.user.id }, data: { status: 'PENDING_KYC' } });
      const s = await createSubmission(storage, target.user.id);

      const res = await review(s.id, APPROVE);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('CANNOT_MODIFY_ADMIN');
      expect((await prisma.kycSubmission.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('PENDING');
    }
  });

  it('an unknown id → 404 KYC_NOT_FOUND', async () => {
    const res = await review(randomUUID(), APPROVE);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('KYC_NOT_FOUND');
  });

  it('audit metadata never holds the NID, a URL or a storage key', async () => {
    const c = await customer();
    const s = await createSubmission(storage, c.user.id);
    await get(`${API}/${s.id}`);
    await review(s.id, REJECT);
    const docs = await prisma.userDocument.findMany({ where: { userId: c.user.id } });

    const rows = await prisma.auditLog.findMany();
    expect(rows.map((r) => r.action).sort()).toEqual(['KYC_REJECTED', 'KYC_VIEWED']);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(c.user.nidNumber);
    expect(dump).not.toMatch(/https?:|\/api\/|sig=|exp=|kyc\//);
    for (const d of docs) expect(dump).not.toContain(d.storageKey);
  });
});
