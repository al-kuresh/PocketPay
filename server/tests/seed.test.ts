// The seed: system wallets, the fee/limit rules from design §6.3–6.4, and 5 demo accounts whose
// money is real ledger history. The expected values below are typed from the design tables, not
// imported from the seed, so a wrong number in the seed fails here.
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedAll } from '../src/db/seed';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { reconcileLedger } from '../src/modules/ledger/reconcile';
import { resetDb } from './helpers/db';

const DEMO_PIN = '48213';
const DEMO_PHONES = ['01800000001', '01800000002', '01800000003', '01800000004', '01800000005'];

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
  expect(await prisma.user.count()).toBe(5);
  expect(await prisma.wallet.count()).toBe(6); // 4 user wallets + 2 system
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
  expect(await systemBalance('SYSTEM_FLOAT')).toBe(-10_000_000n);
  expect(await systemBalance('SYSTEM_FEES')).toBe(0n);

  expect((await reconcileLedger()).ok).toBe(true);
}

describe('seedAll', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('creates system wallets, the design rules, 5 demo accounts and their ledger money', async () => {
    await seedAll();

    await expectSeededState();
    const users = await prisma.user.findMany({ orderBy: { phone: 'asc' } });
    expect(users.map((u) => [u.phone, u.nidNumber, u.name, u.role, u.shopName])).toEqual([
      ['01800000001', '9000000001', 'Demo Admin', 'ADMIN', null],
      ['01800000002', '9000000002', 'Rahim Uddin', 'CUSTOMER', null],
      ['01800000003', '9000000003', 'Karim Hasan', 'CUSTOMER', null],
      ['01800000004', '9000000004', 'Demo Agent', 'AGENT', null],
      ['01800000005', '9000000005', 'Demo Store', 'MERCHANT', 'Demo Store'],
    ]);
    for (const u of users) {
      expect(u.status).toBe('ACTIVE');
      expect(u.dateOfBirth.toISOString().slice(0, 10)).toBe('1995-01-01');
    }
    expect(await prisma.kycSubmission.count()).toBe(0);
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
    await seedAll();
    const before = await prisma.transaction.findMany({ orderBy: { id: 'asc' } });

    await seedAll();

    await expectSeededState();
    expect(await prisma.transaction.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('lets every demo user log in with the demo PIN; the admin has no wallet', async () => {
    await seedAll();
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
