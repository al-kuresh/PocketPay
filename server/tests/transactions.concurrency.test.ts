import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { reconcileLedger } from '../src/modules/ledger/reconcile';
import { executeTransfer } from '../src/modules/transactions/transfer.service';
import { createActor, setLimit, setSetting } from './helpers/actors';
import { resetDb } from './helpers/db';
import { seedSystem } from './helpers/seed';
import { balanceOf, fund } from './helpers/wallets';

type Actor = Awaited<ReturnType<typeof createActor>>;

beforeEach(async () => {
  await resetDb();
  await seedSystem();
});
afterAll(() => prisma.$disconnect());

let n = 0;
const customer = () => {
  n += 1;
  const id = String(n).padStart(8, '0');
  return createActor({ phone: `017${id}`, nid: `90${id}`, role: 'CUSTOMER' });
};

const send = (from: Actor, to: Actor, amount: bigint, idempotencyKey = randomUUID()) =>
  executeTransfer({
    type: 'SEND_MONEY',
    initiatorId: from.user.id,
    receiverPhone: to.user.phone,
    amount,
    pin: '48213',
    idempotencyKey,
    meta: {},
  });

/** How many fulfilled, and the error codes of the rest. */
const outcome = (results: PromiseSettledResult<unknown>[]) => ({
  fulfilled: results.filter((r) => r.status === 'fulfilled').length,
  codes: results.flatMap((r) =>
    r.status === 'rejected' ? [(r.reason as { code?: string }).code ?? String(r.reason)] : [],
  ),
});

describe('limits and the cap hold under parallel requests', () => {
  it('Review focus #1: 10 parallel sends with maxCountDay = 3 → exactly 3 succeed', async () => {
    await setLimit('SEND_MONEY', { maxCountDay: 3 });
    const sender = await customer();
    const receiver = await customer();
    await fund(sender.wallet!.id, 10_000_000n, sender.user.id);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => send(sender, receiver, 1_000n)),
    );

    expect(outcome(results)).toEqual({
      fulfilled: 3,
      codes: Array(7).fill('LIMIT_EXCEEDED'),
    });
    expect(await balanceOf(receiver.wallet!.id)).toBe(3_000n);
    expect((await reconcileLedger()).ok).toBe(true);
  });

  it('5 parallel sends with the same idempotency key → 1 new + 4 replays, money moved once', async () => {
    const sender = await customer();
    const receiver = await customer();
    await fund(sender.wallet!.id, 100_000n, sender.user.id);
    const key = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => send(sender, receiver, 50_000n, key)),
    );

    expect(results.map((r) => r.replayed).sort()).toEqual([false, true, true, true, true]);
    expect(new Set(results.map((r) => r.receipt.trxId)).size).toBe(1);
    expect(await balanceOf(sender.wallet!.id)).toBe(100_000n - 50_500n);
    expect(await balanceOf(receiver.wallet!.id)).toBe(50_000n);
    expect(await prisma.transaction.count({ where: { type: 'SEND_MONEY' } })).toBe(1);
    expect((await reconcileLedger()).ok).toBe(true);
  });

  it('Review focus #2: 5 senders paying one customer near the cap → only the one that fits', async () => {
    await setSetting('CUSTOMER_MAX_BALANCE', '100000'); // ৳1,000
    const receiver = await customer();
    await fund(receiver.wallet!.id, 85_000n, receiver.user.id); // ৳850
    const senders = await Promise.all(Array.from({ length: 5 }, customer));
    for (const s of senders) await fund(s.wallet!.id, 20_000n, s.user.id);

    const results = await Promise.allSettled(senders.map((s) => send(s, receiver, 10_000n)));

    expect(outcome(results)).toEqual({
      fulfilled: 1,
      codes: Array(4).fill('RECEIVER_BALANCE_LIMIT'),
    });
    expect(await balanceOf(receiver.wallet!.id)).toBe(95_000n);
    expect((await reconcileLedger()).ok).toBe(true);
  });
});
