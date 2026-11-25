import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Wallet } from '../src/generated/prisma/client';
import { prisma } from '../src/lib/prisma';
import { postTransaction } from '../src/modules/ledger/ledger.service';
import type { FlowType } from '../src/modules/transactions/flows';
import { toReceipt } from '../src/modules/transactions/receipt.presenter';
import { loadRules } from '../src/modules/transactions/rules';
import {
  executeTransfer,
  makeTransferGuard,
  previewTransfer,
} from '../src/modules/transactions/transfer.service';
import { createActor, setLimit, setSetting } from './helpers/actors';
import { resetDb } from './helpers/db';
import { seedSystem } from './helpers/seed';
import { balanceOf, fund, transfer } from './helpers/wallets';

type Actor = Awaited<ReturnType<typeof createActor>>;
let fees: Wallet;
let rahim: Actor; // customer, the usual sender
let karim: Actor; // customer, the usual receiver
let agent: Actor;
let shop: Actor; // merchant

beforeEach(async () => {
  await resetDb();
  ({ fees } = await seedSystem());
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
const PIN = '48213';

/** executeTransfer with defaults: Rahim sends to Karim with the right PIN and a fresh key. */
const send = (
  amount: bigint,
  o: { type?: FlowType; from?: Actor; to?: Actor; phone?: string; pin?: string; key?: string } = {},
) =>
  executeTransfer({
    type: o.type ?? 'SEND_MONEY',
    initiatorId: (o.from ?? rahim).user.id,
    receiverPhone: o.phone ?? (o.to ?? karim).user.phone,
    amount,
    pin: o.pin ?? PIN,
    idempotencyKey: o.key ?? randomUUID(),
    meta: { ip: '127.0.0.1' },
  });

/** A preview request from Rahim (to Karim unless `to` says otherwise). */
const req = (amount: bigint, type: FlowType = 'SEND_MONEY', to: Actor = karim) => ({
  type,
  initiatorId: rahim.user.id,
  receiverPhone: to.user.phone,
  amount,
});

const appError = (code: string, extra: object = {}) => expect.objectContaining({ code, ...extra });
const failedAttempts = async (a: Actor) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).failedPinAttempts;
const moneyTransactions = () =>
  prisma.transaction.count({ where: { type: { not: 'FLOAT_TOPUP' } } });
const entryCount = (trxId: string) => prisma.ledgerEntry.count({ where: { transaction: { trxId } } });

describe('executeTransfer: exact ledger results per flow', () => {
  it('Send ৳500: sender −50_500, receiver +50_000, fees +500', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    const { receipt, replayed } = await send(50_000n);

    expect(replayed).toBe(false);
    expect(await balanceOf(w(rahim))).toBe(49_500n);
    expect(await balanceOf(w(karim))).toBe(50_000n);
    expect(await balanceOf(fees.id)).toBe(500n);
    expect(await entryCount(receipt.trxId)).toBe(3);
  });

  it('charges no fee on exactly ৳100, and ৳5 on ৳100.01 (Review focus #3)', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    const free = await send(10_000n);
    expect(free.receipt.fee).toBe('0');
    expect(await entryCount(free.receipt.trxId)).toBe(2);

    const paid = await send(10_001n);
    expect(paid.receipt.fee).toBe('500');
    expect(await balanceOf(fees.id)).toBe(500n);
  });

  it('Cash Out ৳1,000: customer −101_850, agent +100_400, fees +1_450', async () => {
    await fund(w(rahim), 200_000n, rahim.user.id);
    await send(100_000n, { type: 'CASH_OUT', to: agent });

    expect(await balanceOf(w(rahim))).toBe(200_000n - 101_850n);
    expect(await balanceOf(w(agent))).toBe(100_400n);
    expect(await balanceOf(fees.id)).toBe(1_450n);
  });

  it('Cash In ৳5,000: agent −500_000, customer +500_000, no fee', async () => {
    await fund(w(agent), 1_000_000n, agent.user.id);
    const { receipt } = await send(500_000n, { type: 'CASH_IN', from: agent, to: rahim });

    expect(await balanceOf(w(agent))).toBe(500_000n);
    expect(await balanceOf(w(rahim))).toBe(500_000n);
    expect(await balanceOf(fees.id)).toBe(0n);
    expect(receipt.mine).toEqual({ amount: '-500000', balanceAfter: '500000' });
  });

  it('Payment ৳250: free by default; with a 1% merchant fee the merchant pays it', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    const free = await send(25_000n, { type: 'PAYMENT', to: shop });
    expect(await entryCount(free.receipt.trxId)).toBe(2);
    expect(await balanceOf(w(shop))).toBe(25_000n);

    await prisma.feeRule.update({ where: { type: 'PAYMENT' }, data: { percentBp: 100 } });
    await send(25_000n, { type: 'PAYMENT', to: shop });
    expect(await balanceOf(w(rahim))).toBe(100_000n - 50_000n); // the customer pays the price only
    expect(await balanceOf(w(shop))).toBe(25_000n + 24_750n);
    expect(await balanceOf(fees.id)).toBe(250n);
  });

  it('refuses a payment whose merchant fee is at least the amount, before the PIN', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    await prisma.feeRule.update({ where: { type: 'PAYMENT' }, data: { flatFee: 500n } });

    await expect(send(500n, { type: 'PAYMENT', to: shop, pin: '00000' })).rejects.toEqual(
      appError('AMOUNT_BELOW_MINIMUM', { statusCode: 422, details: { min: '501' } }),
    );
    expect(await failedAttempts(rahim)).toBe(0);
    expect(await moneyTransactions()).toBe(0);
  });
});

describe('the receipt', () => {
  it("shows the caller's own signed entry, masked parties and money as strings", async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    const { receipt } = await send(50_000n);

    expect(receipt).toEqual({
      trxId: expect.any(String),
      type: 'SEND_MONEY',
      status: 'COMPLETED',
      amount: '50000',
      fee: '500',
      note: null,
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
      from: { name: 'Rahim U***', phone: rahim.user.phone, role: 'CUSTOMER' },
      to: { name: 'Karim H***', phone: karim.user.phone, role: 'CUSTOMER' },
      mine: { amount: '-50500', balanceAfter: '49500' },
    });
    // Only presenter output leaves the service: no hash, NID or full name.
    const json = JSON.stringify(receipt);
    for (const secret of ['pinHash', '$2', karim.user.nidNumber, 'Karim Hasan', 'Rahim Uddin']) {
      expect(json).not.toContain(secret);
    }
  });

  it("gives the receiver its own entry, shows a merchant by shop name, refuses a stranger's wallet", async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    await send(50_000n);
    const t = await prisma.transaction.findFirstOrThrow({
      where: { type: 'SEND_MONEY' },
      include: { entries: true },
    });
    const parties = { from: rahim.user, to: karim.user };
    expect(toReceipt(t, parties, w(karim)).mine).toEqual({
      amount: '50000',
      balanceAfter: '50000',
    });
    expect(() => toReceipt(t, parties, w(agent))).toThrow();

    const pay = await send(1_000n, { type: 'PAYMENT', to: shop });
    expect(pay.receipt.to).toEqual({
      name: 'Selim Store',
      phone: shop.user.phone,
      role: 'MERCHANT',
    });
  });
});

describe('the order of checks: a typo never costs a PIN attempt', () => {
  it('a wrong phone with a wrong PIN → RECEIVER_NOT_FOUND, counter still 0', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    await expect(send(50_000n, { phone: '01799999999', pin: '00000' })).rejects.toEqual(
      appError('RECEIVER_NOT_FOUND', { statusCode: 404 }),
    );
    expect(await failedAttempts(rahim)).toBe(0);
  });

  it('an amount below the minimum with a wrong PIN → AMOUNT_BELOW_MINIMUM, counter still 0', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    await expect(send(999n, { pin: '00000' })).rejects.toEqual(
      appError('AMOUNT_BELOW_MINIMUM', { details: { min: '1000' } }),
    );
    expect(await failedAttempts(rahim)).toBe(0);
  });

  it('an initiator with the wrong role → 403 FORBIDDEN, counter still 0', async () => {
    await fund(w(agent), 100_000n, agent.user.id);
    await expect(send(50_000n, { from: agent, pin: '00000' })).rejects.toEqual(
      appError('FORBIDDEN', { statusCode: 403 }),
    );
    expect(await failedAttempts(agent)).toBe(0);
  });

  it('a wrong PIN → 403 INVALID_PIN { attemptsLeft: 2 } and no transaction', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    await expect(send(50_000n, { pin: '00000' })).rejects.toEqual(
      appError('INVALID_PIN', { statusCode: 403, details: { attemptsLeft: 2 } }),
    );
    expect(await failedAttempts(rahim)).toBe(1);
    expect(await moneyTransactions()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'TRANSACTION_PIN_FAILED' } })).toBe(1);
  });
});

describe('initiator status (Review focus #5)', () => {
  it('a frozen initiator with a still-valid token → 403 ACCOUNT_NOT_ACTIVE { status: FROZEN }', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    await prisma.user.update({ where: { id: rahim.user.id }, data: { status: 'FROZEN' } });
    await expect(send(50_000n)).rejects.toEqual(
      appError('ACCOUNT_NOT_ACTIVE', { statusCode: 403, details: { status: 'FROZEN' } }),
    );
    expect(await moneyTransactions()).toBe(0);
  });

  it('a PENDING_KYC initiator → ACCOUNT_NOT_ACTIVE { status: PENDING_KYC }', async () => {
    const pending = await createActor({
      phone: '01755555555',
      nid: '5555555555',
      role: 'CUSTOMER',
      status: 'PENDING_KYC',
    });
    await expect(send(50_000n, { from: pending })).rejects.toEqual(
      appError('ACCOUNT_NOT_ACTIVE', { details: { status: 'PENDING_KYC' } }),
    );
  });
});

describe('makeTransferGuard re-reads both statuses inside the transaction', () => {
  /** A Send run straight through postTransaction with the guard: no pre-checks at all. */
  const guardedSend = async (amount: bigint) =>
    postTransaction({
      ...transfer(w(rahim), w(karim), amount, rahim.user.id),
      guard: makeTransferGuard({
        type: 'SEND_MONEY',
        initiatorId: rahim.user.id,
        receiverId: karim.user.id,
        limit: (await loadRules(prisma, 'SEND_MONEY')).limit,
        customerWalletId: w(rahim),
        receiverWalletId: w(karim),
        amount,
        credit: amount,
        now: new Date(),
      }),
    });

  beforeEach(() => fund(w(rahim), 100_000n, rahim.user.id));

  it('passes for two ACTIVE users', async () => {
    await guardedSend(10_000n);
    expect(await balanceOf(w(karim))).toBe(10_000n);
  });

  it('a receiver frozen in the DB → RECEIVER_NOT_ACTIVE, nothing written', async () => {
    await prisma.user.update({ where: { id: karim.user.id }, data: { status: 'FROZEN' } });
    await expect(guardedSend(10_000n)).rejects.toEqual(appError('RECEIVER_NOT_ACTIVE'));
    expect(await moneyTransactions()).toBe(0);
    expect(await balanceOf(w(rahim))).toBe(100_000n);
  });

  it('an initiator frozen in the DB → ACCOUNT_NOT_ACTIVE, nothing written', async () => {
    await prisma.user.update({ where: { id: rahim.user.id }, data: { status: 'FROZEN' } });
    await expect(guardedSend(10_000n)).rejects.toEqual(
      appError('ACCOUNT_NOT_ACTIVE', { details: { status: 'FROZEN' } }),
    );
    expect(await moneyTransactions()).toBe(0);
  });
});

describe('the balance cap', () => {
  it('a receiver at cap − ৳100 takes ৳100 but not ৳100.01; nothing written on refusal', async () => {
    await setSetting('CUSTOMER_MAX_BALANCE', '100000'); // ৳1,000
    await fund(w(karim), 90_000n, karim.user.id);
    await fund(w(rahim), 100_000n, rahim.user.id);

    await expect(previewTransfer(req(10_001n))).rejects.toEqual(
      appError('RECEIVER_BALANCE_LIMIT', { statusCode: 422 }),
    );
    await expect(send(10_001n)).rejects.toEqual(appError('RECEIVER_BALANCE_LIMIT'));
    expect(await moneyTransactions()).toBe(0);
    expect(await balanceOf(w(rahim))).toBe(100_000n);

    await send(10_000n);
    expect(await balanceOf(w(karim))).toBe(100_000n);
  });

  it('never caps an agent or merchant receiver', async () => {
    await setSetting('CUSTOMER_MAX_BALANCE', '1000');
    await fund(w(rahim), 1_000_000n, rahim.user.id);
    await send(500_000n, { type: 'PAYMENT', to: shop });
    expect(await balanceOf(w(shop))).toBe(500_000n);
  });
});

describe('idempotency', () => {
  it('the same key twice → the same trxId, replayed: true, money moved once', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    const key = randomUUID();
    const first = await send(50_000n, { key });
    const second = await send(50_000n, { key });

    expect(second.replayed).toBe(true);
    expect(second.receipt).toEqual(first.receipt);
    expect(await balanceOf(w(rahim))).toBe(49_500n);
  });
});

describe('previewTransfer', () => {
  it('Send ৳500 → fee, total and the masked receiver; nothing written', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    expect(await previewTransfer(req(50_000n))).toEqual({
      type: 'SEND_MONEY',
      amount: '50000',
      fee: '500',
      total: '50500',
      receiver: { name: 'Karim H***', phone: karim.user.phone, role: 'CUSTOMER' },
    });
    expect(await moneyTransactions()).toBe(0);
    expect(await balanceOf(w(rahim))).toBe(100_000n);
  });

  it('total is what leaves the sender: amount + fee on Cash Out, the amount on a Payment', async () => {
    await fund(w(rahim), 1_000_000n, rahim.user.id);
    await prisma.feeRule.update({ where: { type: 'PAYMENT' }, data: { percentBp: 100 } });
    expect(await previewTransfer(req(100_000n, 'CASH_OUT', agent))).toMatchObject({
      fee: '1850',
      total: '101850',
    });
    expect(await previewTransfer(req(25_000n, 'PAYMENT', shop))).toMatchObject({
      fee: '250',
      total: '25000',
      receiver: { name: 'Selim Store' },
    });
  });

  it('more than the balance → INSUFFICIENT_BALANCE', async () => {
    await fund(w(rahim), 50_000n, rahim.user.id); // ৳500 doesn't cover ৳500 + ৳5
    await expect(previewTransfer(req(50_000n))).rejects.toEqual(
      appError('INSUFFICIENT_BALANCE', { statusCode: 422 }),
    );
  });

  it('over a limit → LIMIT_EXCEEDED', async () => {
    await fund(w(rahim), 100_000n, rahim.user.id);
    await setLimit('SEND_MONEY', { maxCountDay: 1 });
    await send(10_000n);
    await expect(previewTransfer(req(10_000n))).rejects.toEqual(
      appError('LIMIT_EXCEEDED', {
        details: { period: 'DAY', kind: 'COUNT', limit: '1', used: '1' },
      }),
    );
  });
});
