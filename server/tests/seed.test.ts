// The seed: system wallets, the fee/limit rules from design §6.3–6.4, and 7 demo accounts whose
// money is real ledger history and whose KYC is real documents and submissions. The expected values below are typed from the design tables, not
// imported from the seed, so a wrong number in the seed fails here.
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { assertDemoSeedAllowed, seedAll, seedDemo } from '../src/db/seed';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { reconcileLedger } from '../src/modules/ledger/reconcile';
import { resetDb } from './helpers/db';
import { isWebp } from './helpers/images';

const DEMO_PIN = '48213';
const DEMO_PHONES = [
  '01800000001',
  '01800000002',
  '01800000003',
  '01800000004',
  '01800000005',
  '01800000006',
  '01800000007',
];
const NON_ADMIN_PHONES = DEMO_PHONES.slice(1);
const KYC_KEY = /^kyc\/[0-9a-f-]{36}\/(nid-front|nid-back|selfie)-[0-9a-f-]{36}\.webp$/;

// The seed's images go here: tests never write to server/uploads.
let storage: MemoryStorage;

const EXPECTED_FEES = {
  SEND_MONEY: { flatFee: 500n, percentBp: 0, agentCommissionBp: 0, minAmountForFee: 10_000n },
  CASH_OUT: { flatFee: 0n, percentBp: 185, agentCommissionBp: 40, minAmountForFee: 0n },
  CASH_IN: { flatFee: 0n, percentBp: 0, agentCommissionBp: 0, minAmountForFee: 0n },
  PAYMENT: { flatFee: 0n, percentBp: 0, agentCommissionBp: 0, minAmountForFee: 0n },
  FLOAT_TOPUP: { flatFee: 0n, percentBp: 0, agentCommissionBp: 0, minAmountForFee: 0n },
};

const EXPECTED_LIMITS = {
  SEND_MONEY: {
    minAmount: 1_000n,
    maxPerTxn: 5_000_000n,
    maxCountDay: 100,
    maxCountMonth: 250,
    maxAmountDay: 5_000_000n,
    maxAmountMonth: 30_000_000n,
  },
  CASH_IN: {
    minAmount: 5_000n,
    maxPerTxn: 5_000_000n,
    maxCountDay: 100,
    maxCountMonth: 250,
    maxAmountDay: 5_000_000n,
    maxAmountMonth: 30_000_000n,
  },
  CASH_OUT: {
    minAmount: 5_000n,
    maxPerTxn: 3_000_000n,
    maxCountDay: 100,
    maxCountMonth: 250,
    maxAmountDay: 3_000_000n,
    maxAmountMonth: 20_000_000n,
  },
  PAYMENT: {
    minAmount: 100n,
    maxPerTxn: null,
    maxCountDay: null,
    maxCountMonth: null,
    maxAmountDay: null,
    maxAmountMonth: null,
  },
};

const balanceByPhone = async (phone: string) =>
  (await prisma.wallet.findFirstOrThrow({ where: { user: { phone } } })).balance;
const systemBalance = async (type: 'SYSTEM_FEES' | 'SYSTEM_FLOAT') =>
  (await prisma.wallet.findFirstOrThrow({ where: { type } })).balance;

// { TYPE: row without type/updatedAt } (toEqual ignores properties that are undefined).
const byType = (rows: { type: string; updatedAt: Date }[]) =>
  Object.fromEntries(rows.map((r) => [r.type, { ...r, type: undefined, updatedAt: undefined }]));

async function expectSeededState() {
  expect(await prisma.user.count()).toBe(7);
  expect(await prisma.wallet.count()).toBe(8); // 6 user wallets + 2 system
  // 6 non-admin users × (one submission, 3 documents, 3 stored images).
  expect(await prisma.kycSubmission.count()).toBe(6);
  expect(await prisma.userDocument.count()).toBe(18);
  expect(storage.objects.size).toBe(18);
  expect(await prisma.transaction.count()).toBe(3);
  expect(await prisma.ledgerEntry.count()).toBe(6);

  expect(byType(await prisma.feeRule.findMany())).toEqual(EXPECTED_FEES);
  // No FLOAT_TOPUP row: it's admin-only.
  expect(byType(await prisma.limitRule.findMany())).toEqual(EXPECTED_LIMITS);
  const settings = await prisma.systemSetting.findMany();
  expect(settings.map(({ key, value }) => ({ key, value }))).toEqual([
    { key: 'CUSTOMER_MAX_BALANCE', value: '50000000' },
  ]);

  expect(await balanceByPhone('01800000004')).toBe(8_500_000n); // agent ৳85,000
  expect(await balanceByPhone('01800000002')).toBe(1_000_000n); // Rahim ৳10,000
  expect(await balanceByPhone('01800000003')).toBe(500_000n); // Karim ৳5,000
  expect(await balanceByPhone('01800000005')).toBe(0n); // the store
  expect(await balanceByPhone('01800000006')).toBe(0n); // Jamal
  expect(await balanceByPhone('01800000007')).toBe(0n); // Nusrat
  expect(await systemBalance('SYSTEM_FLOAT')).toBe(-10_000_000n);
  expect(await systemBalance('SYSTEM_FEES')).toBe(0n);

  expect((await reconcileLedger()).ok).toBe(true);
}

describe('seedAll', () => {
  beforeEach(async () => {
    await resetDb();
    storage = new MemoryStorage();
  });
  afterAll(() => prisma.$disconnect());

  it('creates system wallets, the design rules, 7 demo accounts and their ledger money', async () => {
    await seedAll(storage);

    await expectSeededState();
    const users = await prisma.user.findMany({ orderBy: { phone: 'asc' } });
    expect(users.map((u) => [u.phone, u.nidNumber, u.name, u.role, u.shopName])).toEqual([
      ['01800000001', '9000000001', 'Demo Admin', 'ADMIN', null],
      ['01800000002', '9000000002', 'Rahim Uddin', 'CUSTOMER', null],
      ['01800000003', '9000000003', 'Karim Hasan', 'CUSTOMER', null],
      ['01800000004', '9000000004', 'Demo Agent', 'AGENT', null],
      ['01800000005', '9000000005', 'Demo Store', 'MERCHANT', 'Demo Store'],
      ['01800000006', '9000000006', 'Jamal Uddin', 'AGENT', null],
      ['01800000007', '9000000007', 'Nusrat Jahan', 'CUSTOMER', null],
    ]);
    expect(users.map((u) => u.status)).toEqual([
      'ACTIVE',
      'ACTIVE',
      'ACTIVE',
      'ACTIVE',
      'ACTIVE',
      'PENDING_KYC',
      'REJECTED',
    ]);
    for (const u of users) {
      expect(u.dateOfBirth.toISOString().slice(0, 10)).toBe('1995-01-01');
    }
    const admin = users[0]!;
    expect(await prisma.wallet.count({ where: { userId: admin.id } })).toBe(0);

    const txns = await prisma.transaction.findMany({ orderBy: { createdAt: 'asc' } });
    expect(txns.map((t) => [t.type, t.amount, t.idempotencyKey])).toEqual([
      ['FLOAT_TOPUP', 10_000_000n, 'seed:float:agent'],
      ['CASH_IN', 1_000_000n, 'seed:cashin:rahim'],
      ['CASH_IN', 500_000n, 'seed:cashin:karim'],
    ]);
  });

  it('is safe to run twice: replays the money instead of paying it again', async () => {
    await seedAll(storage);
    const before = await prisma.transaction.findMany({ orderBy: { id: 'asc' } });

    await seedAll(storage);

    await expectSeededState();
    expect(await prisma.transaction.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('gives every non-admin demo user 3 private documents and one latest submission', async () => {
    await seedAll(storage);
    const admin = await prisma.user.findUniqueOrThrow({ where: { phone: '01800000001' } });

    for (const phone of NON_ADMIN_PHONES) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { phone },
        include: {
          documents: true,
          kycSubmissions: { include: { nidFront: true, nidBack: true, selfie: true } },
        },
      });
      expect(user.documents.map((d) => d.kind).sort(), phone).toEqual([
        'NID_BACK',
        'NID_FRONT',
        'SELFIE',
      ]);
      expect(user.kycSubmissions, phone).toHaveLength(1);
      const sub = user.kycSubmissions[0]!;
      for (const doc of [sub.nidFront, sub.nidBack, sub.selfie]) {
        expect(doc.userId).toBe(user.id);
        expect(doc.access).toBe('PRIVATE');
        expect(doc.mime).toBe('image/webp');
        expect(doc.storageKey).toMatch(KYC_KEY);
        expect(doc.storageKey.startsWith(`kyc/${user.id}/`)).toBe(true);
        const object = storage.objects.get(doc.storageKey)!;
        expect(object.access).toBe('PRIVATE');
        expect(isWebp(object.body)).toBe(true);
        expect(object.body.length).toBe(doc.sizeBytes);
      }
      // No profile photo is made: the seed never touches profilePhotoKey.
      expect(user.profilePhotoKey).toBeNull();

      if (phone === '01800000006') {
        expect(user.status).toBe('PENDING_KYC');
        expect(sub).toMatchObject({
          status: 'PENDING',
          reviewedById: null,
          reviewedAt: null,
          reason: null,
        });
      } else if (phone === '01800000007') {
        expect(user.status).toBe('REJECTED');
        expect(sub).toMatchObject({
          status: 'REJECTED',
          reviewedById: admin.id,
          reason: 'The NID photo is blurry. Please retake it in good light.',
        });
        expect(sub.reviewedAt).toBeInstanceOf(Date);
      } else {
        expect(user.status).toBe('ACTIVE');
        expect(sub).toMatchObject({ status: 'APPROVED', reviewedById: admin.id, reason: null });
        expect(sub.reviewedAt).toBeInstanceOf(Date);
      }
    }
    expect(await prisma.userDocument.count({ where: { userId: admin.id } })).toBe(0);
    expect(await prisma.kycSubmission.count({ where: { userId: admin.id } })).toBe(0);
  });

  it('re-running adds no documents or submissions and keeps an uploaded profile photo', async () => {
    await seedAll(storage);
    await prisma.user.update({
      where: { phone: '01800000002' },
      data: { profilePhotoKey: 'profile/uploaded-by-rahim.webp' },
    });
    const docs = await prisma.userDocument.findMany({ orderBy: { id: 'asc' } });
    const subs = await prisma.kycSubmission.findMany({ orderBy: { id: 'asc' } });
    const keys = [...storage.objects.keys()].sort();

    await seedAll(storage);

    await expectSeededState();
    expect(await prisma.userDocument.findMany({ orderBy: { id: 'asc' } })).toEqual(docs);
    expect(await prisma.kycSubmission.findMany({ orderBy: { id: 'asc' } })).toEqual(subs);
    expect([...storage.objects.keys()].sort()).toEqual(keys);
    const rahim = await prisma.user.findUniqueOrThrow({ where: { phone: '01800000002' } });
    expect(rahim.profilePhotoKey).toBe('profile/uploaded-by-rahim.webp');
  });

  it('leaves a user who already has a submission alone (an admin decision survives a re-seed)', async () => {
    await seedAll(storage);
    const jamal = await prisma.user.findUniqueOrThrow({ where: { phone: '01800000006' } });
    await prisma.$transaction([
      prisma.user.update({ where: { id: jamal.id }, data: { status: 'ACTIVE' } }),
      prisma.kycSubmission.updateMany({
        where: { userId: jamal.id },
        data: { status: 'APPROVED' },
      }),
    ]);

    await seedAll(storage);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: jamal.id } })).status).toBe(
      'ACTIVE',
    );
    const subs = await prisma.kycSubmission.findMany({ where: { userId: jamal.id } });
    expect(subs.map((s) => s.status)).toEqual(['APPROVED']);
  });

  it('lets every demo user log in with the demo PIN; the admin has no wallet', async () => {
    await seedAll(storage);
    const app = createApp({ storage: new MemoryStorage() });

    for (const phone of DEMO_PHONES) {
      const res = await request(app).post('/api/v1/auth/login').send({ phone, pin: DEMO_PIN });
      expect(res.status, phone).toBe(200);
    }
    const { accessToken } = (
      await request(app).post('/api/v1/auth/login').send({ phone: '01800000001', pin: DEMO_PIN })
    ).body.data;
    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.body.data.user.role).toBe('ADMIN');
    expect(me.body.data.wallet).toBeNull();
  });

  it('refuses a remote database before writing anything', async () => {
    // The Prisma client was built from the test URL already; only the check reads the stub.
    vi.stubEnv('DATABASE_URL', 'postgresql://pocketpay:s3cret-pw@db.example.com:5432/pocketpay');
    try {
      await expect(seedAll(storage)).rejects.toThrow(/db\.example\.com/);
      await expect(seedDemo(storage)).rejects.toThrow(/db\.example\.com/);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(await prisma.wallet.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it('refuses a demo phone that already belongs to another role, before any money moves', async () => {
    await prisma.user.create({
      data: {
        phone: '01800000004',
        nidNumber: '1234567890',
        name: 'Not The Agent',
        dateOfBirth: new Date('1995-06-15'),
        pinHash: 'not-a-real-hash',
        role: 'CUSTOMER',
      },
    });

    await expect(seedAll(storage)).rejects.toThrow(
      'Phone 01800000004 already belongs to a CUSTOMER, not the demo AGENT',
    );
    expect(await prisma.transaction.count()).toBe(0);
  });
});

describe('assertDemoSeedAllowed', () => {
  const url = (host: string) => `postgresql://pocketpay:s3cret-pw@${host}:5432/pocketpay`;
  const errorOf = (env: NodeJS.ProcessEnv) => {
    try {
      assertDemoSeedAllowed(env);
    } catch (err) {
      return err as Error;
    }
    return undefined;
  };

  it.each(['localhost', '127.0.0.1', '[::1]'])('allows the local host %s', (host) => {
    expect(errorOf({ DATABASE_URL: url(host) })).toBeUndefined();
  });

  it('refuses production, even on a local host', () => {
    expect(errorOf({ NODE_ENV: 'production', DATABASE_URL: url('localhost') })?.message).toBe(
      'Demo seeding is disabled in production; Phase 10 decides how the live demo is seeded',
    );
  });

  it.each([
    ['a remote host', url('db.example.com'), /db\.example\.com/],
    ['a DATABASE_URL that is not a URL', 'not a url s3cret-pw', /no host/],
  ])('refuses %s without leaking the password', (_, databaseUrl, message) => {
    const err = errorOf({ DATABASE_URL: databaseUrl });
    expect(err?.message).toMatch(message);
    expect(err?.message).not.toContain('s3cret-pw');
  });

  it('allows a remote host listed in DEMO_SEED_ALLOWED_HOSTS (exact match only)', () => {
    const allowed = 'other.example.com, demo-db.example.com';
    expect(
      errorOf({ DATABASE_URL: url('demo-db.example.com'), DEMO_SEED_ALLOWED_HOSTS: allowed }),
    ).toBeUndefined();
    expect(
      errorOf({ DATABASE_URL: url('db.example.com'), DEMO_SEED_ALLOWED_HOSTS: 'example.com' }),
    ).toBeInstanceOf(Error);
  });
});

describe('prisma/seed.ts', () => {
  it('refuses to run in production', () => {
    const res = spawnSync('npx', ['tsx', 'prisma/seed.ts'], {
      // The test DB URL stays in env, so even a broken check couldn't reach a real database.
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
    });

    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain(
      'Demo seeding is disabled in production; Phase 10 decides how the live demo is seeded',
    );
  });
});
