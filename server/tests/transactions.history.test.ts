import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import type { FlowType } from '../src/modules/transactions/flows';
import { executeTransfer } from '../src/modules/transactions/transfer.service';
import { generateTrxId } from '../src/utils/trxId';
import { dhakaToday } from '../src/utils/time';
import { createActor } from './helpers/actors';
import { resetDb } from './helpers/db';
import { seedSystem } from './helpers/seed';
import { fund } from './helpers/wallets';

type Actor = Awaited<ReturnType<typeof createActor>>;
let app: ReturnType<typeof createApp>;
let rahim: Actor; // customer, the usual sender
let karim: Actor; // customer, the usual receiver
let agent: Actor;
let stranger: Actor; // a third customer, in no transaction
let admin: Actor;

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
  stranger = await createActor({
    phone: '01755555555',
    nid: '5555555555',
    role: 'CUSTOMER',
    name: 'Jamal Stranger',
  });
  admin = await createActor({ phone: '01766666666', nid: '6666666666', role: 'ADMIN' });
});
afterAll(() => prisma.$disconnect());

const w = (a: Actor) => a.wallet!.id;
const DAY = 86_400_000;

const history = (as: Actor, query: Record<string, string> = {}) =>
  request(app)
    .get('/api/v1/transactions')
    .query(query)
    .set('Authorization', `Bearer ${as.token}`);
const receipt = (as: Actor, trxId: string) =>
  request(app).get(`/api/v1/transactions/${trxId}`).set('Authorization', `Bearer ${as.token}`);

/** A real money flow through the service (PIN and all); returns the trxId. */
const move = async (type: FlowType, from: Actor, to: Actor, amount: bigint) =>
  (
    await executeTransfer({
      type,
      initiatorId: from.user.id,
      receiverPhone: to.user.phone,
      amount,
      pin: '48213',
      idempotencyKey: randomUUID(),
      meta: {},
    })
  ).receipt.trxId;

/** Nothing from the full user rows (hash, NID, unmasked names) may appear in a response. */
const expectNoLeak = (res: { body: unknown }) => {
  const json = JSON.stringify(res.body);
  for (const a of [rahim, karim, agent, stranger, admin]) {
    expect(json).not.toContain(a.user.pinHash);
    expect(json).not.toContain(a.user.nidNumber);
    expect(json).not.toContain(a.user.name);
  }
  expect(json).not.toContain('pinHash');
  expect(json).not.toContain('nidNumber');
};

/** Rahim is funded ৳2,000, sends ৳500 to Karim, then cashes out ৳1,000 at the agent. */
const sendThenCashOut = async () => {
  await fund(w(rahim), 200_000n, rahim.user.id);
  const send = await move('SEND_MONEY', rahim, karim, 50_000n);
  const cashOut = await move('CASH_OUT', rahim, agent, 100_000n);
  return { send, cashOut };
};

describe('GET /transactions (history)', () => {
  it("the sender's history: newest first, OUT, the signed total, the receiver masked", async () => {
    const { send, cashOut } = await sendThenCashOut();

    const res = await history(rahim);

    expect(res.status).toBe(200);
    const { items, nextCursor } = res.body.data;
    // The 2 money flows, plus the ৳2,000 top-up that funded the sender.
    expect(items.map((i: { type: string }) => i.type)).toEqual([
      'CASH_OUT',
      'SEND_MONEY',
      'FLOAT_TOPUP',
    ]);
    expect(nextCursor).toBeNull();
    expect(items[1]).toEqual({
      trxId: send,
      type: 'SEND_MONEY',
      direction: 'OUT',
      amount: '50500',
      counterparty: { name: 'Karim H***', phone: karim.user.phone, role: 'CUSTOMER' },
      balanceAfter: '149500',
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
    });
    expect(items[0]).toMatchObject({
      trxId: cashOut,
      direction: 'OUT',
      amount: '101850',
      counterparty: { name: 'Abdul A***', role: 'AGENT' },
      balanceAfter: '47650',
    });
    expectNoLeak(res);
  });

  it("the receiver's history: IN, the amount received, the sender as counterparty", async () => {
    const { send } = await sendThenCashOut();

    const res = await history(karim);

    expect(res.body.data.items).toEqual([
      expect.objectContaining({
        trxId: send,
        direction: 'IN',
        amount: '50000',
        counterparty: { name: 'Rahim U***', phone: rahim.user.phone, role: 'CUSTOMER' },
        balanceAfter: '50000',
      }),
    ]);
    expectNoLeak(res);
  });

  it("the agent's history: the Cash Out as IN with commission, a top-up from PocketPay", async () => {
    await sendThenCashOut();
    await fund(w(agent), 30_000n, admin.user.id);

    const res = await history(agent);

    const [topup, cashOut] = res.body.data.items;
    expect(cashOut).toMatchObject({
      type: 'CASH_OUT',
      direction: 'IN',
      amount: '100400',
      counterparty: { name: 'Rahim U***', role: 'CUSTOMER' },
    });
    expect(topup).toMatchObject({
      type: 'FLOAT_TOPUP',
      direction: 'IN',
      amount: '30000',
      counterparty: { name: 'PocketPay', phone: null, role: 'SYSTEM' },
    });
    expectNoLeak(res);
  });

  it('pages 25 transactions as 10, 10, 5 by seq, with no repeats or gaps', async () => {
    for (let i = 0; i < 25; i++) await fund(w(karim), 100n, karim.user.id);
    const expected = (
      await prisma.ledgerEntry.findMany({
        where: { walletId: w(karim) },
        orderBy: { seq: 'desc' },
        include: { transaction: true },
      })
    ).map((e) => e.transaction.trxId);

    const pages: string[][] = [];
    let cursor: string | null = null;
    do {
      const res = await history(karim, { limit: '10', ...(cursor && { cursor }) });
      expect(res.status).toBe(200);
      pages.push(res.body.data.items.map((i: { trxId: string }) => i.trxId));
      cursor = res.body.data.nextCursor;
      if (cursor !== null) expect(cursor).toMatch(/^\d+$/);
    } while (cursor !== null && pages.length < 5);

    expect(pages.map((p) => p.length)).toEqual([10, 10, 5]);
    expect(pages.flat()).toEqual(expected);
  });

  it('defaults to 20 items per page', async () => {
    for (let i = 0; i < 21; i++) await fund(w(karim), 100n, karim.user.id);
    const res = await history(karim);
    expect(res.body.data.items).toHaveLength(20);
    expect(res.body.data.nextCursor).not.toBeNull();
  });

  it('filters by type', async () => {
    const { send } = await sendThenCashOut();

    const sends = await history(rahim, { type: 'SEND_MONEY' });
    expect(sends.body.data.items.map((i: { trxId: string }) => i.trxId)).toEqual([send]);

    const topups = await history(rahim, { type: 'FLOAT_TOPUP' });
    expect(topups.body.data.items).toHaveLength(1);
  });

  it('filters by Dhaka date, both ends inclusive', async () => {
    const today = dhakaToday();
    const old = dhakaToday(new Date(Date.now() - 3 * DAY));
    // A back-dated transaction: postTransaction can't set created_at, so the row and its two
    // balanced entries are inserted directly (append-only, sum-zero holds at commit).
    const oldTrxId = generateTrxId();
    const createdAt = new Date(`${old}T12:00:00+06:00`);
    await prisma.$transaction(async (tx) => {
      const t = await tx.transaction.create({
        data: {
          trxId: oldTrxId,
          type: 'SEND_MONEY',
          amount: 1_000n,
          fromWalletId: w(rahim),
          toWalletId: w(karim),
          initiatedById: rahim.user.id,
          idempotencyKey: randomUUID(),
          createdAt,
        },
      });
      await tx.ledgerEntry.createMany({
        data: [
          { transactionId: t.id, walletId: w(rahim), amount: -1_000n, balanceAfter: 0n, createdAt },
          { transactionId: t.id, walletId: w(karim), amount: 1_000n, balanceAfter: 1_000n, createdAt },
        ],
      });
    });
    await fund(w(rahim), 100_000n, rahim.user.id);
    const todays = await move('SEND_MONEY', rahim, karim, 10_000n);

    const ids = async (query: Record<string, string>) =>
      (await history(karim, query)).body.data.items.map((i: { trxId: string }) => i.trxId);

    const yesterday = dhakaToday(new Date(Date.now() - DAY));
    expect(await ids({ to: yesterday })).toEqual([oldTrxId]); // `to` excludes today
    expect(await ids({ from: today })).toEqual([todays]);
    expect(await ids({ from: old, to: today })).toEqual([todays, oldTrxId]);
    expect(await ids({ from: old, to: old })).toEqual([oldTrxId]); // one day, inclusive
  });

  it('an admin (no wallet) gets an empty list', async () => {
    await sendThenCashOut();
    const res = await history(admin);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: [], nextCursor: null });
  });

  it('refuses a bad query with 400 VALIDATION_ERROR, and no token with 401', async () => {
    const badQueries: Record<string, string>[] = [
      { limit: '0' },
      { limit: '51' },
      { limit: 'abc' },
      { cursor: 'abc' },
      { cursor: '-1' },
      { from: '2026-02-30' },
      { to: '24-11-2026' },
      { type: 'FOO' },
    ];
    for (const query of badQueries) {
      const res = await history(rahim, query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await request(app).get('/api/v1/transactions')).status).toBe(401);
  });
});

describe('GET /transactions/:trxId (receipt)', () => {
  it('gives the sender and the receiver each their own `mine`', async () => {
    const { send } = await sendThenCashOut();

    const forRahim = await receipt(rahim, send);
    const forKarim = await receipt(karim, send);

    expect(forRahim.status).toBe(200);
    expect(forRahim.body.data).toMatchObject({
      trxId: send,
      type: 'SEND_MONEY',
      amount: '50000',
      fee: '500',
      from: { name: 'Rahim U***', role: 'CUSTOMER' },
      to: { name: 'Karim H***', role: 'CUSTOMER' },
      mine: { amount: '-50500', balanceAfter: '149500' },
    });
    expect(forKarim.body.data.mine).toEqual({ amount: '50000', balanceAfter: '50000' });
    expectNoLeak(forRahim);
    expectNoLeak(forKarim);
  });

  it('answers a stranger, an admin and an unknown id with the same 404 TRANSACTION_NOT_FOUND', async () => {
    const { send } = await sendThenCashOut();

    const forStranger = await receipt(stranger, send);
    const forAdmin = await receipt(admin, send);
    const unknown = await receipt(rahim, 'PP23456789');

    for (const res of [forStranger, forAdmin, unknown]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TRANSACTION_NOT_FOUND');
    }
    // Byte for byte the same: nothing tells "exists but not yours" from "doesn't exist".
    expect(forStranger.body).toEqual(unknown.body);
    expect(forAdmin.body).toEqual(unknown.body);
  });

  it('refuses a malformed trxId with 400 VALIDATION_ERROR', async () => {
    for (const bad of ['abc', 'PP2345678', 'PP234567890', 'pp23456789', 'PP2345678O']) {
      const res = await receipt(rahim, bad);
      expect(res.status, bad).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
