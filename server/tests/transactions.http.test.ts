import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { reconcileLedger } from '../src/modules/ledger/reconcile';
import { createActor, setLimit } from './helpers/actors';
import { resetDb } from './helpers/db';
import { seedSystem } from './helpers/seed';
import { balanceOf, fund } from './helpers/wallets';

const TRX_ID = /^PP[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
const PIN = '48213';
const WRONG_PIN = '48214';

type Actor = Awaited<ReturnType<typeof createActor>>;
let app: ReturnType<typeof createApp>;
let rahim: Actor; // customer, the usual sender
let karim: Actor; // customer, the usual receiver
let agent: Actor;
let shop: Actor; // merchant

beforeEach(async () => {
  await resetDb();
  await seedSystem();
  app = createApp({ storage: new MemoryStorage() });
  rahim = await createActor({
    phone: '01711111111',
    nid: '1111111111',
    role: 'CUSTOMER',
    name: 'Rahim Uddin',
  });
  karim = await createActor({
    phone: '01722222222',
    nid: '2222222222',
    role: 'CUSTOMER',
    name: 'Karim Hasan',
  });
  agent = await createActor({
    phone: '01733333333',
    nid: '3333333333',
    role: 'AGENT',
    name: 'Abdul Agent',
  });
  shop = await createActor({
    phone: '01744444444',
    nid: '4444444444',
    role: 'MERCHANT',
    name: 'Selim Owner',
    shopName: 'Selim Store',
  });
});
afterAll(() => prisma.$disconnect());

const w = (a: Actor) => a.wallet!.id;

/** A money POST. `key: null` sends no Idempotency-Key header; `as: null` sends no token. */
const post = (
  path: string,
  body: object,
  o: { as?: Actor | null; key?: string | null } = {},
) => {
  const as = o.as === undefined ? rahim : o.as;
  const key = o.key === undefined ? randomUUID() : o.key;
  let r = request(app).post(`/api/v1/transactions/${path}`);
  if (as) r = r.set('Authorization', `Bearer ${as.token}`);
  if (key !== null) r = r.set('Idempotency-Key', key);
  return r.send(body);
};
const body = (to: Actor, amount: string, extra: object = {}) => ({
  receiverPhone: to.user.phone,
  amount,
  pin: PIN,
  ...extra,
});
const failedAttempts = async (a: Actor) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).failedPinAttempts;

/** Nothing from the full user rows (hash, NID, unmasked names) may appear in a response. */
const expectNoLeak = (res: { body: unknown }) => {
  const json = JSON.stringify(res.body);
  for (const a of [rahim, karim, agent, shop]) {
    expect(json).not.toContain(a.user.pinHash);
    expect(json).not.toContain(a.user.nidNumber);
    expect(json).not.toContain(a.user.name);
  }
  expect(json).not.toContain('pinHash');
  expect(json).not.toContain('nidNumber');
};

describe('the 4 money POSTs: happy paths', () => {
  const cases = [
    { path: 'send-money', from: () => rahim, to: () => karim, amount: '50000', fee: '500' },
    { path: 'cash-out', from: () => rahim, to: () => agent, amount: '100000', fee: '1850' },
    { path: 'payment', from: () => rahim, to: () => shop, amount: '25000', fee: '0' },
    { path: 'cash-in', from: () => agent, to: () => rahim, amount: '500000', fee: '0' },
  ];

  for (const c of cases) {
    it(`POST /${c.path} → 201 with a receipt and replayed: false`, async () => {
      await fund(w(c.from()), 1_000_000n, c.from().user.id);

      const res = await post(c.path, body(c.to(), c.amount), { as: c.from() });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.replayed).toBe(false);
      const { receipt } = res.body.data;
      expect(receipt.trxId).toMatch(TRX_ID);
      expect(receipt).toMatchObject({ amount: c.amount, fee: c.fee, status: 'COMPLETED' });
      for (const money of [receipt.amount, receipt.fee, receipt.mine.amount, receipt.mine.balanceAfter]) {
        expect(typeof money).toBe('string');
      }
      expectNoLeak(res);
    });
  }

  it('keeps a trimmed note on the receipt', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    const res = await post('send-money', body(karim, '10000', { note: '  rent  ' }));
    expect(res.status).toBe(201);
    expect(res.body.data.receipt.note).toBe('rent');
  });
});

describe('idempotency', () => {
  beforeEach(() => fund(w(rahim), 1_000_000n, rahim.user.id));

  it('the same key again → 200, replayed: true, the same trxId, money moved once', async () => {
    const key = randomUUID();
    const first = await post('send-money', body(karim, '50000'), { key });
    const second = await post('send-money', body(karim, '50000'), { key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.replayed).toBe(true);
    expect(second.body.data.receipt.trxId).toBe(first.body.data.receipt.trxId);
    expect(await balanceOf(w(rahim))).toBe(1_000_000n - 50_500n);
  });

  it('the same key with a different amount → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = randomUUID();
    await post('send-money', body(karim, '50000'), { key });
    const res = await post('send-money', body(karim, '60000'), { key });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('no header, or a key that is not a UUID → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    for (const key of [null, 'abc']) {
      const res = await post('send-money', body(karim, '50000'), { key });
      expect(res.status, String(key)).toBe(400);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    }
    expect(await prisma.transaction.count({ where: { type: 'SEND_MONEY' } })).toBe(0);
  });
});

describe('auth and roles', () => {
  it('no token → 401', async () => {
    const res = await post('send-money', body(karim, '50000'), { as: null });
    expect(res.status).toBe(401);
  });

  it('an AGENT calling send-money, or a CUSTOMER calling cash-in → 403 FORBIDDEN', async () => {
    const agentSend = await post('send-money', body(karim, '50000'), { as: agent });
    expect(agentSend.status).toBe(403);
    expect(agentSend.body.error.code).toBe('FORBIDDEN');

    const customerCashIn = await post('cash-in', body(karim, '50000'), { as: rahim });
    expect(customerCashIn.status).toBe(403);
    expect(customerCashIn.body.error.code).toBe('FORBIDDEN');
  });
});

describe('validation never costs a PIN attempt', () => {
  it('a bad amount ("15.50") or a bad phone → 400 VALIDATION_ERROR, counter untouched', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    const badAmount = await post('send-money', body(karim, '15.50', { pin: WRONG_PIN }));
    const badPhone = await post('send-money', {
      ...body(karim, '50000', { pin: WRONG_PIN }),
      receiverPhone: '12345',
    });

    for (const res of [badAmount, badPhone]) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await failedAttempts(rahim)).toBe(0);
  });

  it('accepts Bangla digits in the PIN', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    const res = await post('send-money', body(karim, '10000', { pin: '৪৮২১৩' }));
    expect(res.status).toBe(201);
  });
});

describe('error codes reach the client with the right HTTP status', () => {
  beforeEach(() => fund(w(rahim), 100_000n, rahim.user.id));

  it('INVALID_PIN → 403 with attemptsLeft', async () => {
    const res = await post('send-money', body(karim, '50000', { pin: WRONG_PIN }));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'INVALID_PIN', details: { attemptsLeft: 2 } });
  });

  it('ACCOUNT_LOCKED → 423', async () => {
    await prisma.user.update({
      where: { id: rahim.user.id },
      data: { lockedUntil: new Date(Date.now() + 10 * 60_000) },
    });
    const res = await post('send-money', body(karim, '50000'));
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('INSUFFICIENT_BALANCE → 422', async () => {
    const res = await post('send-money', body(karim, '100000')); // ৳1,000 + ৳5 fee > ৳1,000
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('LIMIT_EXCEEDED → 422 with the details as strings', async () => {
    await setLimit('SEND_MONEY', { maxCountDay: 1 });
    expect((await post('send-money', body(karim, '10000'))).status).toBe(201);
    const res = await post('send-money', body(karim, '10000'));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      details: { period: 'DAY', kind: 'COUNT', limit: '1', used: '1' },
    });
  });
});

describe('POST /transactions/preview', () => {
  const preview = (as: Actor, b: object) =>
    request(app)
      .post('/api/v1/transactions/preview')
      .set('Authorization', `Bearer ${as.token}`)
      .send(b);

  it('200 with fee and total, needs no Idempotency-Key, writes nothing', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    const res = await preview(rahim, {
      type: 'SEND_MONEY',
      receiverPhone: karim.user.phone,
      amount: '50000',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      type: 'SEND_MONEY',
      amount: '50000',
      fee: '500',
      total: '50500',
      receiver: { name: 'Karim H***', phone: karim.user.phone, role: 'CUSTOMER' },
    });
    expect(await prisma.transaction.count({ where: { type: 'SEND_MONEY' } })).toBe(0);
    expectNoLeak(res);
  });

  it('an AGENT previewing SEND_MONEY → 403 FORBIDDEN; an unknown type → 400', async () => {
    const res = await preview(agent, {
      type: 'SEND_MONEY',
      receiverPhone: karim.user.phone,
      amount: '50000',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const bad = await preview(rahim, {
      type: 'FLOAT_TOPUP',
      receiverPhone: karim.user.phone,
      amount: '50000',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a MERCHANT may not preview at all → 403', async () => {
    const res = await preview(shop, {
      type: 'PAYMENT',
      receiverPhone: shop.user.phone,
      amount: '50000',
    });
    expect(res.status).toBe(403);
  });
});

describe('over HTTP, in parallel', () => {
  it('20 parallel ৳100 sends from a ৳1,000 wallet → exactly 10 × 201 and 10 × 422', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => post('send-money', body(karim, '10000'))),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused.map((r) => `${r.status} ${r.body.error?.code}`)).toEqual(
      Array(10).fill('422 INSUFFICIENT_BALANCE'),
    );
    expect(await balanceOf(w(rahim))).toBe(0n);
    expect(await balanceOf(w(karim))).toBe(100_000n);
    expect((await reconcileLedger()).ok).toBe(true);
  });

  it('5 parallel identical requests (same key) → 1 × 201 + 4 × 200 replayed, money moved once', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    const key = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => post('send-money', body(karim, '50000'), { key })),
    );

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    for (const r of results) expect(r.body.data.replayed).toBe(r.status === 200);
    expect(new Set(results.map((r) => r.body.data.receipt.trxId)).size).toBe(1);
    expect(await balanceOf(w(rahim))).toBe(100_000n - 50_500n);
    expect(await prisma.transaction.count({ where: { type: 'SEND_MONEY' } })).toBe(1);
    expect((await reconcileLedger()).ok).toBe(true);
  });
});

describe("a Cash In limit is the customer's: the agent never sees it", () => {
  beforeEach(async () => {
    await setLimit('CASH_IN', { maxCountDay: 1 });
    await fund(w(agent), 1_000_000n, agent.user.id);
    // Rahim's one Cash In for today is used up.
    expect((await post('cash-in', body(rahim, '5000'), { as: agent })).status).toBe(201);
  });

  it('an agent previewing a Cash In to a customer at their limit → 200 (only checks about the caller)', async () => {
    const res = await request(app)
      .post('/api/v1/transactions/preview')
      .set('Authorization', `Bearer ${agent.token}`)
      .send({ type: 'CASH_IN', receiverPhone: rahim.user.phone, amount: '5000' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ type: 'CASH_IN', amount: '5000', fee: '0' });
  });

  it('the POST → 422 RECEIVER_LIMIT_EXCEEDED with no details: no "used", no "limit"', async () => {
    const res = await post('cash-in', body(rahim, '5000'), { as: agent });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('RECEIVER_LIMIT_EXCEEDED');
    expect(res.body.error.details).toBeUndefined();
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('"used"');
    expect(json).not.toContain('"limit"');
    expect(await prisma.transaction.count({ where: { type: 'CASH_IN' } })).toBe(1);
  });
});

describe('the money rate limit', () => {
  it('counts per USER across the money POSTs and preview: the 31st → 429, another user still passes', async () => {
    // Limiters skip when NODE_ENV is 'test'; switch that off for this test only.
    const nodeEnv = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      // Bodies the limiter counts and validation then refuses (400): cheap, and no PIN is checked.
      const preview = (as: Actor) =>
        request(app)
          .post('/api/v1/transactions/preview')
          .set('Authorization', `Bearer ${as.token}`)
          .send({});
      // One budget for all five routes: 15 sends + 15 previews use it up.
      for (let i = 1; i <= 15; i++) {
        expect((await post('send-money', {}, { as: rahim })).status, `send ${i}`).toBe(400);
        expect((await preview(rahim)).status, `preview ${i}`).toBe(400);
      }
      const blocked = await post('cash-out', {}, { as: rahim });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');

      // Same IP (supertest, 127.0.0.1), another user: not limited.
      expect((await post('send-money', {}, { as: karim })).status).toBe(400);
    } finally {
      env.NODE_ENV = nodeEnv;
    }
  });
});
