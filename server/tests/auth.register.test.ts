import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from '../src/app';
import { logger } from '../src/lib/logger';
import type { OtpProvider } from '../src/lib/otp';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { verifyPin } from '../src/modules/auth/pin';
import { verifyAccessToken } from '../src/modules/auth/tokens';
import { resetDb } from './helpers/db';
import { bigPng, isWebp, testJpeg } from './helpers/images';

const PHONE = '01712345678';
const NID = '1234567890';
const PIN = '48213';
const DOB = '1995-06-15';

const fakeOtp: OtpProvider = { send: async () => {} };

const validFields = {
  name: 'Rahim Uddin',
  dateOfBirth: DOB,
  nidNumber: NID,
  role: 'CUSTOMER',
  pin: PIN,
  confirmPin: PIN,
};

let images: { nidFront: Buffer; nidBack: Buffer; selfie: Buffer };
let storage: MemoryStorage;

beforeAll(async () => {
  images = {
    nidFront: await testJpeg(1200, 760, '#EA580C'),
    nidBack: await testJpeg(1200, 760, '#0F172A'),
    selfie: await testJpeg(900, 1200, '#16A34A'),
  };
});

beforeEach(async () => {
  await resetDb();
  storage = new MemoryStorage();
});
afterAll(() => prisma.$disconnect());

const makeApp = (deps: AppDeps = {}) => createApp({ otpProvider: fakeOtp, storage, ...deps });

/** Steps 1–2 of registration: request + verify an OTP, return the registration token. */
async function registerToToken(app: ReturnType<typeof createApp>, phone = PHONE) {
  const { devOtp } = (
    await request(app).post('/api/v1/auth/register/request-otp').send({ phone })
  ).body.data;
  const verified = await request(app)
    .post('/api/v1/auth/register/verify-otp')
    .send({ phone, code: devOtp });
  return verified.body.data.registrationToken as string;
}

/** Step 4: the multipart request. Override fields/files, or pass null to leave a file out. */
function complete(
  app: ReturnType<typeof createApp>,
  token: string | null,
  opts: {
    fields?: Record<string, string | undefined>;
    files?: Partial<Record<'nidFront' | 'nidBack' | 'selfie', Buffer | null>>;
  } = {},
) {
  let req = request(app).post('/api/v1/auth/register/complete');
  if (token !== null) req = req.set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries({ ...validFields, ...opts.fields })) {
    if (v !== undefined) req = req.field(k, v);
  }
  for (const name of ['nidFront', 'nidBack', 'selfie'] as const) {
    const buf = opts.files && name in opts.files ? opts.files[name] : images[name];
    if (buf) req = req.attach(name, buf, `${name}.jpg`);
  }
  return req;
}

const otherUser = (overrides: { phone?: string; nidNumber?: string } = {}) =>
  prisma.user.create({
    data: {
      phone: '01898765432',
      nidNumber: '9999999999',
      name: 'Someone Else',
      dateOfBirth: new Date('1990-01-01'),
      pinHash: 'x',
      role: 'CUSTOMER',
      ...overrides,
    },
  });

describe('POST /auth/register/complete', () => {
  it('creates a PENDING_KYC customer with documents, a submission and a session', async () => {
    const app = makeApp();
    const token = await registerToToken(app);

    const res = await complete(app, token);

    expect(res.status).toBe(201);
    const { user, accessToken } = res.body.data;
    expect(user).toMatchObject({
      phone: PHONE,
      name: 'Rahim Uddin',
      role: 'CUSTOMER',
      status: 'PENDING_KYC',
      kycStatus: 'PENDING',
      nidMasked: '*******890',
    });
    expect(user.profilePhotoUrl).toMatch(/^memory:\/\/profile\//);
    expect(user.shopName).toBeNull();

    // Nothing sensitive leaves the server.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(NID);
    expect(body).not.toContain('pinHash');
    expect(body).not.toContain(PIN);
    expect(body).not.toContain('dateOfBirth');
    expect(body).not.toContain(DOB);

    // Access token identifies the new user.
    expect(verifyAccessToken(accessToken)).toEqual({ userId: user.id, role: 'CUSTOMER' });

    // Refresh cookie.
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('pp_rt=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('SameSite=Lax');

    // Storage: 3 private KYC images + 1 public profile photo, all processed WebP.
    const objects = [...storage.objects.entries()];
    expect(objects.filter(([, o]) => o.access === 'PRIVATE')).toHaveLength(3);
    expect(objects.filter(([, o]) => o.access === 'PUBLIC')).toHaveLength(1);
    const originals = Object.values(images);
    for (const [key, o] of objects) {
      expect(isWebp(o.body)).toBe(true);
      expect(o.contentType).toBe('image/webp');
      expect(originals.some((orig) => orig.equals(o.body))).toBe(false);
      expect(key).toContain(user.id);
    }
    const [, profile] = objects.find(([, o]) => o.access === 'PUBLIC')!;
    expect(await sharp(profile.body).metadata()).toMatchObject({ width: 512, height: 512 });

    // Database rows.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.dateOfBirth.toISOString().slice(0, 10)).toBe(DOB);
    expect(row.pinHash).not.toBe(PIN);
    expect(await verifyPin(PIN, row.pinHash)).toBe(true);
    expect(row.shopName).toBeNull();
    expect(await prisma.userDocument.count({ where: { userId: user.id } })).toBe(4);
    expect(await prisma.kycSubmission.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);
    expect(
      (await prisma.otpCode.findFirstOrThrow({ where: { phone: PHONE } })).consumedAt,
    ).not.toBeNull();

    // Exactly one wallet, of the user's role, starting empty.
    const wallets = await prisma.wallet.findMany({ where: { userId: user.id } });
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({ type: 'CUSTOMER', balance: 0n });
    expect(await prisma.wallet.count()).toBe(1);

    // One audit row, without the NID.
    const audits = await prisma.auditLog.findMany({ where: { action: 'REGISTERED' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: user.id,
      metadata: { role: 'CUSTOMER', autoApproved: false },
    });
    expect(JSON.stringify(audits[0])).not.toContain(NID);
  });

  it('auto-approves customers when kycAutoApprove is on', async () => {
    const app = makeApp({ kycAutoApprove: true });
    const res = await complete(app, await registerToToken(app));

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ status: 'ACTIVE', kycStatus: 'APPROVED' });
    const sub = await prisma.kycSubmission.findFirstOrThrow();
    expect(sub.reason).toBe('auto-approved');
  });

  it('never auto-approves agents', async () => {
    const app = makeApp({ kycAutoApprove: true });
    const res = await complete(app, await registerToToken(app), { fields: { role: 'AGENT' } });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ status: 'PENDING_KYC', kycStatus: 'PENDING' });
  });

  it('creates an AGENT wallet for an agent', async () => {
    const app = makeApp();
    const res = await complete(app, await registerToToken(app), { fields: { role: 'AGENT' } });

    expect(res.status).toBe(201);
    const wallets = await prisma.wallet.findMany({ where: { userId: res.body.data.user.id } });
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({ type: 'AGENT', balance: 0n });
  });

  it('stores shopName for a merchant', async () => {
    const app = makeApp();
    const res = await complete(app, await registerToToken(app), {
      fields: { role: 'MERCHANT', shopName: 'Rahim Store' },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.shopName).toBe('Rahim Store');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.data.user.id } });
    expect(row.shopName).toBe('Rahim Store');
  });

  it('refuses to reuse a registration token', async () => {
    const app = makeApp();
    const token = await registerToToken(app);
    expect((await complete(app, token)).status).toBe(201);

    const again = await complete(app, token, { fields: { nidNumber: '5555555555' } });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('REGISTRATION_TOKEN_INVALID');
  });

  it('creates exactly one user when the same token is submitted twice at once', async () => {
    const app = makeApp();
    const token = await registerToToken(app);

    const results = await Promise.all([complete(app, token), complete(app, token)]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect([401, 409]).toContain(statuses[1]);
    expect(await prisma.user.count()).toBe(1);
    // The losing request's uploads were cleaned up: only the winner's 4 objects remain.
    expect(storage.objects.size).toBe(4);
  });

  it('rejects a duplicate NID before uploading anything', async () => {
    await otherUser({ nidNumber: NID });
    const app = makeApp();

    const res = await complete(app, await registerToToken(app));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NID_TAKEN');
    expect(storage.objects.size).toBe(0);
  });

  it('maps a NID race inside the transaction to NID_TAKEN and deletes the uploads', async () => {
    // Another registration with the same NID lands after our early check but before our insert.
    class RacingStorage extends MemoryStorage {
      raced = false;
      async put(o: Parameters<MemoryStorage['put']>[0]) {
        await super.put(o);
        if (!this.raced && this.objects.size === 4) {
          this.raced = true;
          await otherUser({ nidNumber: NID });
        }
      }
    }
    storage = new RacingStorage();
    const app = makeApp();

    const res = await complete(app, await registerToToken(app));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NID_TAKEN');
    expect(storage.objects.size).toBe(0);
    expect(await prisma.user.count({ where: { phone: PHONE } })).toBe(0);
    // No wallet either. (user.create fails before wallet.create runs; the rollback test is below.)
    expect(await prisma.wallet.count()).toBe(0);
  });

  it('deletes every uploaded object when an upload fails, and keeps the token usable', async () => {
    class FlakyStorage extends MemoryStorage {
      calls = 0;
      async put(o: Parameters<MemoryStorage['put']>[0]) {
        if (++this.calls === 3) throw new Error('storage down');
        await super.put(o);
      }
    }
    storage = new FlakyStorage();
    const app = makeApp();
    const token = await registerToToken(app);

    const res = await complete(app, token);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPLOAD_FAILED');
    expect(storage.objects.size).toBe(0);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.wallet.count()).toBe(0);
    // Nothing was committed, so the same token works once storage is back.
    storage = new MemoryStorage();
    expect((await complete(makeApp(), token)).status).toBe(201);
  });

  it('rolls the wallet back with the user when a later step in the transaction fails', async () => {
    // kycSubmission.create runs after tx.wallet.create, so this proves the wallet is in the same
    // transaction as the rest of the account. NOT VALID: only new rows are checked.
    await prisma.$executeRaw`ALTER TABLE kyc_submissions ADD CONSTRAINT test_block_insert CHECK (false) NOT VALID`;
    try {
      const app = makeApp();
      const res = await complete(app, await registerToToken(app));
      expect(res.status).toBe(500); // an unmapped DB error is a 500 INTERNAL_ERROR
    } finally {
      await prisma.$executeRaw`ALTER TABLE kyc_submissions DROP CONSTRAINT test_block_insert`;
    }

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.wallet.count()).toBe(0);
    expect(storage.objects.size).toBe(0); // the uploads were cleaned up
  });

  it('logs only the kind and access (no storage key) when a cleanup delete fails', async () => {
    class BrokenStorage extends MemoryStorage {
      calls = 0;
      async put(o: Parameters<MemoryStorage['put']>[0]) {
        if (++this.calls === 3) throw new Error('storage down');
        await super.put(o);
      }
      async delete(): Promise<void> {
        throw new Error('delete failed too');
      }
    }
    storage = new BrokenStorage();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const app = makeApp();

    const res = await complete(app, await registerToToken(app));

    expect(res.status).toBe(502);
    // 3 puts succeeded, so 3 deletes were attempted and each failure was logged.
    const cleanupWarnings = warn.mock.calls.filter(([, msg]) => msg === 'Upload cleanup failed');
    expect(cleanupWarnings).toHaveLength(3);
    for (const [fields] of cleanupWarnings) {
      expect(Object.keys(fields as object).sort()).toEqual(['access', 'kind']);
    }
    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of [NID, PIN, DOB, 'Rahim', 'kyc/', 'profile/']) expect(logged).not.toContain(secret);
    warn.mockRestore();
  });

  it('requires every image', async () => {
    const app = makeApp();
    const res = await complete(app, await registerToToken(app), { files: { selfie: null } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FILE');
    expect(res.body.error.details.field).toBe('selfie');
  });

  it('rejects a text file posing as an image', async () => {
    const app = makeApp();
    const res = await complete(app, await registerToToken(app), {
      files: { nidFront: Buffer.from('definitely not a jpeg') },
    });

    expect(res.status).toBe(415);
    expect(storage.objects.size).toBe(0);
  });

  it('accepts a 9 MB image (the limit is 10 MB per image)', async () => {
    const app = makeApp();
    const res = await complete(app, await registerToToken(app), { files: { nidFront: await bigPng() } });

    expect(res.status).toBe(201);
  });

  it('rejects an 11 MB image (over the 10 MB limit)', async () => {
    const app = makeApp();
    const res = await complete(app, await registerToToken(app), {
      files: { nidFront: Buffer.alloc(11 * 1024 * 1024) },
    });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it.each([
    ['a merchant without shopName', { role: 'MERCHANT' }],
    ['an under-18 date of birth', { dateOfBirth: '2015-01-01' }],
    ['a weak PIN', { pin: '12345', confirmPin: '12345' }],
  ])('rejects %s with VALIDATION_ERROR', async (_label, fields) => {
    const app = makeApp();
    const res = await complete(app, await registerToToken(app), { fields });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a request without a token, even with valid images, and stores nothing', async () => {
    const res = await complete(makeApp(), null);

    expect(res.status).toBe(401);
    expect(storage.objects.size).toBe(0);
  });

  it('checks the token before reading the upload', async () => {
    // An 11 MB file would be 413 if the upload were parsed first; 401 proves auth runs first.
    const res = await complete(makeApp(), null, {
      files: { nidFront: Buffer.alloc(11 * 1024 * 1024) },
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REGISTRATION_TOKEN_INVALID');
  });

  it.each([
    ['no Authorization header', null],
    ['a garbage token', 'not-a-jwt'],
  ])('rejects %s with REGISTRATION_TOKEN_INVALID', async (_label, token) => {
    const res = await complete(makeApp(), token);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REGISTRATION_TOKEN_INVALID');
  });
});
