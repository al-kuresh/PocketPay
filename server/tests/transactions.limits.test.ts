import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { TransactionStatus } from '../src/generated/prisma/enums';
import { prisma } from '../src/lib/prisma';
import { postTransaction } from '../src/modules/ledger/ledger.service';
import { type FlowType, FLOWS } from '../src/modules/transactions/flows';
import {
  checkAmountBounds,
  checkBalanceCap,
  checkPeriodLimits,
} from '../src/modules/transactions/limits';
import { loadCustomerMaxBalance, loadRules } from '../src/modules/transactions/rules';
import { generateTrxId } from '../src/utils/trxId';
import { createActor, setLimit, setSetting } from './helpers/actors';
import { resetDb } from './helpers/db';
import { seedSystem } from './helpers/seed';
import { fund, transfer } from './helpers/wallets';

type Actor = Awaited<ReturnType<typeof createActor>>;
let rahim: Actor;
let karim: Actor;
let agent: Actor;

beforeEach(async () => {
  await resetDb();
  await seedSystem();
  rahim = await createActor({ phone: '01711111111', nid: '1111111111', role: 'CUSTOMER' });
  karim = await createActor({ phone: '01722222222', nid: '2222222222', role: 'CUSTOMER' });
  agent = await createActor({ phone: '01733333333', nid: '3333333333', role: 'AGENT' });
});
afterAll(() => prisma.$disconnect());

const w = (a: Actor) => a.wallet!.id;

/** A real money movement through the ledger (created_at = now). */
const move = (from: Actor, to: Actor, amount: bigint, type: FlowType = 'SEND_MONEY') =>
  postTransaction(transfer(w(from), w(to), amount, from.user.id, { type }));

/**
 * A transactions row inserted as it is, for what postTransaction can't produce: a REVERSED
 * status or a fixed created_at. Inserted, never updated (guard 9). No ledger entries: only
 * the limit queries read it.
 */
const insertRow = (
  from: Actor,
  to: Actor,
  amount: bigint,
  extra: { type?: FlowType; status?: TransactionStatus; createdAt?: Date } = {},
) =>
  prisma.transaction.create({
    data: {
      trxId: generateTrxId(),
      type: 'SEND_MONEY',
      amount,
      fromWalletId: w(from),
      toWalletId: w(to),
      initiatedById: from.user.id,
      idempotencyKey: randomUUID(),
      ...extra,
    },
  });

/** The limit check exactly as a flow runs it: the rule from the DB, the side from FLOWS. */
const check = async (type: FlowType, customer: Actor, amount: bigint, now = new Date()) =>
  checkPeriodLimits(prisma, {
    type,
    limit: (await loadRules(prisma, type)).limit,
    customerWalletId: w(customer),
    side: FLOWS[type].limitSide,
    amount,
    now,
  });

const limitExceeded = (details: object) => ({ statusCode: 422, code: 'LIMIT_EXCEEDED', details });

describe('loadRules and loadCustomerMaxBalance', () => {
  it('loads the seeded fee and limit rules of the flow', async () => {
    const send = await loadRules(prisma, 'SEND_MONEY');
    expect(send.fee).toMatchObject({ type: 'SEND_MONEY', flatFee: 500n, minAmountForFee: 10_000n });
    expect(send.limit).toMatchObject({
      type: 'SEND_MONEY',
      minAmount: 1_000n,
      maxPerTxn: 5_000_000n,
    });
    expect((await loadRules(prisma, 'CASH_OUT')).fee).toMatchObject({ percentBp: 185 });
  });

  it('reads CUSTOMER_MAX_BALANCE as poisha, and throws when the row is missing', async () => {
    expect(await loadCustomerMaxBalance(prisma)).toBe(50_000_000n); // ৳5,00,000
    await setSetting('CUSTOMER_MAX_BALANCE', '100000');
    expect(await loadCustomerMaxBalance(prisma)).toBe(100_000n);

    await prisma.systemSetting.delete({ where: { key: 'CUSTOMER_MAX_BALANCE' } });
    await expect(loadCustomerMaxBalance(prisma)).rejects.toThrow('CUSTOMER_MAX_BALANCE');
  });

  it('refuses a CUSTOMER_MAX_BALANCE that is not a plain digit string', async () => {
    // BigInt('') is 0n and BigInt(' 5') is 5n: without the check, '' would cap everyone at ৳0.
    for (const bad of ['', ' 100', '-5', '1.5', '1e6', '0x10', 'abc']) {
      await setSetting('CUSTOMER_MAX_BALANCE', bad);
      const err = await loadCustomerMaxBalance(prisma).catch((e: unknown) => e);
      expect(err, bad).toBeInstanceOf(Error);
      expect(err, bad).not.toHaveProperty('code'); // a plain Error, not an AppError
      expect((err as Error).message, bad).toContain('CUSTOMER_MAX_BALANCE');
    }
  });
});

describe('checkAmountBounds', () => {
  it('enforces the SEND_MONEY minimum (৳10) and maximum (৳50,000) per transaction', async () => {
    const { limit } = await loadRules(prisma, 'SEND_MONEY');

    expect(() => checkAmountBounds(limit, 999n)).toThrow(
      expect.objectContaining({
        statusCode: 422,
        code: 'AMOUNT_BELOW_MINIMUM',
        details: { min: '1000' },
      }),
    );
    expect(() => checkAmountBounds(limit, 1_000n)).not.toThrow();
    expect(() => checkAmountBounds(limit, 5_000_000n)).not.toThrow();
    expect(() => checkAmountBounds(limit, 5_000_001n)).toThrow(
      expect.objectContaining({
        statusCode: 422,
        code: 'AMOUNT_ABOVE_MAXIMUM',
        details: { max: '5000000' },
      }),
    );
  });

  it('has no maximum for PAYMENT, and no bounds at all without a rule', async () => {
    const { limit } = await loadRules(prisma, 'PAYMENT');
    expect(() => checkAmountBounds(limit, 10_000_000_000n)).not.toThrow();
    expect(() => checkAmountBounds(null, 1n)).not.toThrow();
  });
});

describe('checkPeriodLimits', () => {
  it('refuses the next send once the daily count is used up', async () => {
    await setLimit('SEND_MONEY', { maxCountDay: 2 });
    await fund(w(rahim), 100_000n, rahim.user.id);

    await move(rahim, karim, 1_000n);
    await expect(check('SEND_MONEY', rahim, 1_000n)).resolves.toBeUndefined();
    await move(rahim, karim, 1_000n);

    await expect(check('SEND_MONEY', rahim, 1_000n)).rejects.toMatchObject(
      limitExceeded({ period: 'DAY', kind: 'COUNT', limit: '2', used: '2' }),
    );
  });

  it('refuses a send that would take the day over ৳50,000', async () => {
    await fund(w(rahim), 4_500_000n, rahim.user.id);
    await move(rahim, karim, 4_500_000n); // ৳45,000 today

    await expect(check('SEND_MONEY', rahim, 500_000n)).resolves.toBeUndefined(); // exactly ৳50,000
    await expect(check('SEND_MONEY', rahim, 500_001n)).rejects.toMatchObject(
      limitExceeded({ period: 'DAY', kind: 'AMOUNT', limit: '5000000', used: '4500000' }),
    );
  });

  it("counts only the sender's own COMPLETED rows of the same type", async () => {
    await setLimit('SEND_MONEY', { maxCountDay: 1 });
    await fund(w(rahim), 100_000n, rahim.user.id);
    await fund(w(karim), 100_000n, karim.user.id);

    await move(rahim, agent, 10_000n, 'CASH_OUT'); // another type
    await move(karim, rahim, 1_000n); // money rahim received, not sent
    await insertRow(rahim, karim, 1_000n, { status: 'REVERSED' }); // not COMPLETED
    await expect(check('SEND_MONEY', rahim, 1_000n)).resolves.toBeUndefined();

    await move(rahim, karim, 1_000n);
    await expect(check('SEND_MONEY', rahim, 1_000n)).rejects.toMatchObject(
      limitExceeded({ period: 'DAY', kind: 'COUNT', limit: '1', used: '1' }),
    );
  });

  it('counts a CASH_IN against the receiving customer, not the agent', async () => {
    await setLimit('CASH_IN', { maxCountDay: 2 });
    await fund(w(agent), 100_000n, agent.user.id);
    await move(agent, rahim, 5_000n, 'CASH_IN');
    await move(agent, rahim, 5_000n, 'CASH_IN');

    await expect(check('CASH_IN', rahim, 5_000n)).rejects.toMatchObject(
      limitExceeded({ period: 'DAY', kind: 'COUNT', limit: '2', used: '2' }),
    );
    // The same agent can still cash in to someone else.
    await expect(check('CASH_IN', karim, 5_000n)).resolves.toBeUndefined();
  });

  it('starts the day at 00:00 Dhaka (18:00Z) and the month on the 1st in Dhaka', async () => {
    await setLimit('SEND_MONEY', { maxCountDay: 1, maxCountMonth: 1 });
    // 23:59:59 on 24 November in Dhaka.
    await insertRow(rahim, karim, 1_000n, { createdAt: new Date('2026-11-24T17:59:59Z') });

    // Still 24 November in Dhaka: today's count sees it.
    await expect(
      check('SEND_MONEY', rahim, 1_000n, new Date('2026-11-24T17:59:59Z')),
    ).rejects.toMatchObject(limitExceeded({ period: 'DAY', kind: 'COUNT', limit: '1', used: '1' }));
    // 00:00 on 25 November in Dhaka: a new day, but still the same month.
    await expect(
      check('SEND_MONEY', rahim, 1_000n, new Date('2026-11-24T18:00:00Z')),
    ).rejects.toMatchObject(
      limitExceeded({ period: 'MONTH', kind: 'COUNT', limit: '1', used: '1' }),
    );
    // 00:00 on 1 December in Dhaka: a new month too.
    await expect(
      check('SEND_MONEY', rahim, 1_000n, new Date('2026-11-30T18:00:00Z')),
    ).resolves.toBeUndefined();
  });

  it('checks DAY COUNT, DAY AMOUNT, MONTH COUNT, MONTH AMOUNT in order; NULL means no limit', async () => {
    await insertRow(rahim, karim, 1_000n); // today
    await setLimit('SEND_MONEY', {
      maxCountDay: 1,
      maxAmountDay: 1_000n,
      maxCountMonth: 1,
      maxAmountMonth: 1_000n,
    });
    const failsWith = (period: string, kind: string, limit: string, used: string) =>
      expect(check('SEND_MONEY', rahim, 1n)).rejects.toMatchObject(
        limitExceeded({ period, kind, limit, used }),
      );

    await failsWith('DAY', 'COUNT', '1', '1');
    await setLimit('SEND_MONEY', { maxCountDay: null });
    await failsWith('DAY', 'AMOUNT', '1000', '1000');
    await setLimit('SEND_MONEY', { maxAmountDay: null });
    await failsWith('MONTH', 'COUNT', '1', '1');
    await setLimit('SEND_MONEY', { maxCountMonth: null });
    await failsWith('MONTH', 'AMOUNT', '1000', '1000');
    await setLimit('SEND_MONEY', { maxAmountMonth: null });
    await expect(check('SEND_MONEY', rahim, 1n)).resolves.toBeUndefined();
  });

  it('runs no checks without a limit rule', async () => {
    await insertRow(rahim, karim, 1_000n);
    await expect(
      checkPeriodLimits(prisma, {
        type: 'SEND_MONEY',
        limit: null,
        customerWalletId: w(rahim),
        side: 'from',
        amount: 10_000_000_000n,
        now: new Date(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('checkBalanceCap', () => {
  it('caps a CUSTOMER at CUSTOMER_MAX_BALANCE, and never an agent or merchant', async () => {
    const cap = await loadCustomerMaxBalance(prisma);
    const credit = (receiverType: 'CUSTOMER' | 'AGENT' | 'MERCHANT', amount: bigint) => () =>
      checkBalanceCap({ receiverType, balance: cap - 100n, credit: amount, cap });

    expect(credit('CUSTOMER', 100n)).not.toThrow();
    expect(credit('CUSTOMER', 101n)).toThrow(
      expect.objectContaining({ statusCode: 422, code: 'RECEIVER_BALANCE_LIMIT' }),
    );
    expect(credit('AGENT', 10_000_000n)).not.toThrow();
    expect(credit('MERCHANT', 10_000_000n)).not.toThrow();
  });
});
