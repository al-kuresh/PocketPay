import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { postTransaction } from '../src/modules/ledger/ledger.service';
import { reconcileLedger } from '../src/modules/ledger/reconcile';
import { loadRules } from '../src/modules/transactions/rules';
import { executeTransfer, makeTransferGuard } from '../src/modules/transactions/transfer.service';
import { createActor, setLimit, setSetting } from './helpers/actors';
import { resetDb } from './helpers/db';
import { seedSystem } from './helpers/seed';
import { balanceOf, fund, transfer } from './helpers/wallets';

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

const send = (from: Actor, to: Actor, amount: bigint) =>
  executeTransfer({
    type: 'SEND_MONEY',
    initiatorId: from.user.id,
    receiverPhone: to.user.phone,
    amount,
    pin: '48213',
    idempotencyKey: randomUUID(),
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
  // Straight through postTransaction with the guard: from ONE user, more than 3 parallel
  // executeTransfer calls trip the PIN lockout's attempt claim (423) before the guard runs.
  it('Review focus #1: 10 parallel sends with maxCountDay = 3 → exactly 3 succeed', async () => {
    await setLimit('SEND_MONEY', { maxCountDay: 3 });
    const sender = await customer();
    const receiver = await customer();
    await fund(sender.wallet!.id, 10_000_000n, sender.user.id);
    const { limit } = await loadRules(prisma, 'SEND_MONEY');
    const guardedSend = (amount: bigint) =>
      postTransaction({
        ...transfer(sender.wallet!.id, receiver.wallet!.id, amount, sender.user.id),
        guard: makeTransferGuard({
          type: 'SEND_MONEY',
          initiatorId: sender.user.id,
          receiverId: receiver.user.id,
          limit,
          customerWalletId: sender.wallet!.id,
          receiverWalletId: receiver.wallet!.id,
          amount,
          credit: amount,
          now: new Date(),
        }),
      });

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => guardedSend(1_000n)));

    expect(outcome(results)).toEqual({
      fulfilled: 3,
      codes: Array(7).fill('LIMIT_EXCEEDED'),
    });
    expect(await balanceOf(receiver.wallet!.id)).toBe(3_000n);
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
