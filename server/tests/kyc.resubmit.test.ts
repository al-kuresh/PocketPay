import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import type { Role, UserStatus } from '../src/generated/prisma/enums';
import { logger } from '../src/lib/logger';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { createActor } from './helpers/actors';
import { resetDb } from './helpers/db';
import { isWebp, testJpeg } from './helpers/images';
import { createSubmission } from './helpers/kyc';

const REASON = 'The NID photo is blurry. Please retake it in good light.';
const FILES = ['nidFront', 'nidBack', 'selfie'] as const;

let storage: MemoryStorage;
let app: ReturnType<typeof createApp>;
let seq = 0;
let jpegs: Record<(typeof FILES)[number], Buffer>;

beforeEach(async () => {
  await resetDb();
  storage = new MemoryStorage();
  app = createApp({ storage });
  jpegs = {
    nidFront: await testJpeg(800, 600, '#123456'),
    nidBack: await testJpeg(800, 600, '#654321'),
    selfie: await testJpeg(600, 800, '#abcdef'),
  };
});
afterAll(() => prisma.$disconnect());

/**
 * A user as an admin's rejection leaves them (unless `status` says otherwise): one REJECTED
 * submission with its 3 private images, and a public profile photo.
 */
async function rejectedUser(opts: { role?: Exclude<Role, 'ADMIN'>; status?: UserStatus } = {}) {
  seq++;
  const n = String(seq).padStart(4, '0');
  const actor = await createActor({
    phone: `0180000${n}`,
    nid: `900000${n}`,
    role: opts.role ?? 'CUSTOMER',
    status: opts.status ?? 'REJECTED',
    name: 'Nusrat Jahan',
  });
  const id = actor.user.id;
  const old = await createSubmission(storage, id, {
    status: 'REJECTED',
    reason: REASON,
    reviewedAt: new Date('2026-11-20T08:00:00Z'),
    submittedAt: new Date('2026-11-19T08:00:00Z'),
  });
  const photoKey = `profile/${id}/old.webp`;
  await storage.put({ key: photoKey, body: Buffer.from('old photo'), contentType: 'image/webp', access: 'PUBLIC' });
  await prisma.userDocument.create({
    data: { userId: id, kind: 'PROFILE', access: 'PUBLIC', storageKey: photoKey, mime: 'image/webp', sizeBytes: 9, width: 1, height: 1 },
  });
  await prisma.user.update({ where: { id }, data: { profilePhotoKey: photoKey } });
  return { ...actor, id, old, photoKey };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
function resubmit(token: string | null, files: Partial<Record<(typeof FILES)[number], Buffer | null>> = {}, a = app) {
  let req = request(a).post('/api/v1/kyc/resubmit');
  if (token) req = req.set(as(token));
  for (const f of FILES) {
    const body = f in files ? files[f] : jpegs[f];
    if (body) req = req.attach(f, body, `${f}.jpg`);
  }
  return req;
}

/** Everything a failed resubmit must leave untouched. */
async function snapshot(userId: string) {
  return {
    user: await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true, profilePhotoKey: true } }),
    submissions: await prisma.kycSubmission.count({ where: { userId } }),
    documents: await prisma.userDocument.count({ where: { userId } }),
    audit: await prisma.auditLog.count(),
    objects: [...storage.objects.keys()].sort(),
  };
}

describe('GET /kyc', () => {
  it("returns the latest submission's status, reason and dates", async () => {
    const u = await rejectedUser();

    const res = await request(app).get('/api/v1/kyc').set(as(u.token));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      status: 'REJECTED',
      reason: REASON,
      submittedAt: '2026-11-19T08:00:00.000Z',
      reviewedAt: '2026-11-20T08:00:00.000Z',
    });
  });

  it('is null for a user with no submission, and 401 without a token', async () => {
    const admin = await createActor({ phone: '01900000001', nid: '1900000001', role: 'ADMIN' });

    expect((await request(app).get('/api/v1/kyc').set(as(admin.token))).body.data).toBeNull();
    expect((await request(app).get('/api/v1/kyc')).status).toBe(401);
  });
});

describe('POST /kyc/resubmit', () => {
  it('a REJECTED user → 201, a new PENDING submission, PENDING_KYC, a new profile photo and an audit row', async () => {
    const u = await rejectedUser();

    const res = await resubmit(u.token);

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ id: u.id, status: 'PENDING_KYC', kycStatus: 'PENDING' });
    expect(res.body.data.kyc).toMatchObject({ status: 'PENDING', reason: null, reviewedAt: null });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(user.status).toBe('PENDING_KYC');

    // The old submission is kept (history); the new one is the latest, with 3 new private images.
    const subs = await prisma.kycSubmission.findMany({
      where: { userId: u.id },
      orderBy: { submittedAt: 'desc' },
      include: { nidFront: true, nidBack: true, selfie: true },
    });
    expect(subs.map((s) => s.status)).toEqual(['PENDING', 'REJECTED']);
    expect(subs[1]!.id).toBe(u.old.id);
    const fresh = subs[0]!;
    for (const d of [fresh.nidFront, fresh.nidBack, fresh.selfie]) {
      expect(d.access).toBe('PRIVATE');
      expect(d.storageKey).toMatch(new RegExp(`^kyc/${u.id}/[a-z-]+-[0-9a-f-]{36}\\.webp$`));
      expect(storage.objects.get(d.storageKey)?.access).toBe('PRIVATE');
      expect(isWebp(storage.objects.get(d.storageKey)!.body)).toBe(true);
    }
    // The old images stay, for the admin's history.
    expect(await prisma.userDocument.count({ where: { userId: u.id, access: 'PRIVATE' } })).toBe(6);

    // The selfie's avatar replaces the profile photo; the old one is gone (row and object).
    expect(user.profilePhotoKey).not.toBe(u.photoKey);
    expect(user.profilePhotoKey).toMatch(new RegExp(`^profile/${u.id}/[0-9a-f-]{36}\\.webp$`));
    expect(storage.objects.get(user.profilePhotoKey!)?.access).toBe('PUBLIC');
    expect(storage.objects.has(u.photoKey)).toBe(false);
    const profiles = await prisma.userDocument.findMany({ where: { userId: u.id, kind: 'PROFILE' } });
    expect(profiles.map((p) => p.storageKey)).toEqual([user.profilePhotoKey]);
    expect(res.body.data.user.profilePhotoUrl).toBe(storage.publicUrl(user.profilePhotoKey!));

    const audit = await prisma.auditLog.findMany({ where: { action: 'KYC_RESUBMITTED' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: u.id,
      targetType: 'user',
      targetId: u.id,
      metadata: { submissionId: fresh.id, autoApproved: false },
    });
    const meta = JSON.stringify(audit[0]!.metadata);
    for (const secret of [u.user.nidNumber, u.user.phone, 'kyc/', 'profile/', 'http']) {
      expect(meta).not.toContain(secret);
    }

    const after = await request(app).get('/api/v1/kyc').set(as(u.token));
    expect(after.body.data).toMatchObject({ status: 'PENDING', reason: null, reviewedAt: null });
  });

  it('auto-approve: a customer becomes ACTIVE with an APPROVED submission; an agent still waits', async () => {
    const auto = createApp({ storage, kycAutoApprove: true });
    const customer = await rejectedUser({ role: 'CUSTOMER' });
    const agent = await rejectedUser({ role: 'AGENT' });

    const c = await resubmit(customer.token, {}, auto);
    const a = await resubmit(agent.token, {}, auto);

    expect(c.status).toBe(201);
    expect(c.body.data.user).toMatchObject({ status: 'ACTIVE', kycStatus: 'APPROVED' });
    expect(c.body.data.kyc).toMatchObject({ status: 'APPROVED', reason: 'auto-approved' });
    expect(c.body.data.kyc.reviewedAt).not.toBeNull();
    expect(a.status).toBe(201);
    expect(a.body.data.user).toMatchObject({ status: 'PENDING_KYC', kycStatus: 'PENDING' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'KYC_RESUBMITTED', actorId: customer.id } });
    expect(audit.metadata).toMatchObject({ autoApproved: true });
  });

  it.each(['PENDING_KYC', 'ACTIVE', 'FROZEN'] as const)('a %s user → 409 KYC_RESUBMIT_NOT_ALLOWED, nothing changes', async (status) => {
    const u = await rejectedUser({ status });
    const before = await snapshot(u.id);

    const res = await resubmit(u.token);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('KYC_RESUBMIT_NOT_ALLOWED');
    expect(await snapshot(u.id)).toEqual(before);
  });

  it('two resubmits in parallel → one 201, one 409, one new submission, no stray objects (5 rounds)', async () => {
    for (let round = 0; round < 5; round++) {
      const u = await rejectedUser();

      const results = await Promise.all([resubmit(u.token), resubmit(u.token)]);

      expect(results.map((r) => r.status).sort(), `round ${round}`).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe('KYC_RESUBMIT_NOT_ALLOWED');
      expect(await prisma.kycSubmission.count({ where: { userId: u.id } }), `round ${round}`).toBe(2);
      expect(await prisma.auditLog.count({ where: { action: 'KYC_RESUBMITTED', actorId: u.id } })).toBe(1);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe('PENDING_KYC');
      // The loser's uploads were deleted: 3 old + 3 new private images, 1 profile photo.
      const keys = [...storage.objects.keys()];
      expect(keys.filter((k) => k.startsWith(`kyc/${u.id}/`))).toHaveLength(6);
      expect(keys.filter((k) => k.startsWith(`profile/${u.id}/`))).toHaveLength(1);
    }
  });

  it('a bad file → 415, no DB change, no stored objects left', async () => {
    const u = await rejectedUser();
    const before = await snapshot(u.id);

    const res = await resubmit(u.token, { nidBack: Buffer.from('definitely not a jpeg') });

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await snapshot(u.id)).toEqual(before);
  });

  it('a missing image → 400 MISSING_FILE', async () => {
    const u = await rejectedUser();

    const res = await resubmit(u.token, { selfie: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'MISSING_FILE', details: { field: 'selfie' } });
  });

  it('no token → 401 before the upload is read', async () => {
    expect((await resubmit(null)).status).toBe(401);
  });

  it('the transaction fails → the new uploads are deleted and the user stays REJECTED', async () => {
    const u = await rejectedUser();
    const before = await snapshot(u.id);
    await prisma.$executeRaw`ALTER TABLE kyc_submissions ADD CONSTRAINT test_block_insert CHECK (false) NOT VALID`;
    try {
      expect((await resubmit(u.token)).status).toBe(500);
    } finally {
      await prisma.$executeRaw`ALTER TABLE kyc_submissions DROP CONSTRAINT test_block_insert`;
    }
    expect(await snapshot(u.id)).toEqual(before);
  });

  it('a failed upload → 502, the other uploads deleted, and no storage key or user data in the logs', async () => {
    const u = await rejectedUser();
    const before = await snapshot(u.id);
    let puts = 0;
    const put = storage.put.bind(storage);
    storage.put = async (o) => {
      if (++puts === 2) throw new Error('storage down');
      await put(o);
    };
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const res = await resubmit(u.token);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('UPLOAD_FAILED');
      expect(error).toHaveBeenCalled();
      const logged = JSON.stringify([...error.mock.calls, ...warn.mock.calls]);
      for (const secret of ['kyc/', 'profile/', u.id, u.user.nidNumber, u.user.phone]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
    expect(await snapshot(u.id)).toEqual(before);
  });

  it('rate-limits per USER: the 6th resubmit in an hour is 429, another user still passes', async () => {
    // Limiters skip when NODE_ENV is 'test'; switch that off for this test only.
    const nodeEnv = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      const u = await rejectedUser({ status: 'ACTIVE' }); // each try is a cheap 409
      for (let i = 1; i <= 5; i++) expect((await resubmit(u.token)).status, `try ${i}`).toBe(409);
      const blocked = await resubmit(u.token);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');

      const other = await rejectedUser();
      expect((await resubmit(other.token)).status).toBe(201);
    } finally {
      env.NODE_ENV = nodeEnv;
    }
  });
});
