// Real parallel requests against Postgres: row locks, lock order and idempotency under load.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { LEDGER_TX_OPTIONS, postTransaction } from '../src/modules/ledger/ledger.service';
import type { AppError } from '../src/utils/AppError';
import { resetDb } from './helpers/db';
import {
  balanceOf,
  createSystemWallets,
  createUserWithWallet,
  fund,
  transfer,
} from './helpers/wallets';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const times = <T>(n: number, fn: (i: number) => T) => Array.from({ length: n }, (_, i) => fn(i));
const postgresCode = (err: unknown) =>
  (err as { meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } })?.meta
    ?.driverAdapterError?.cause?.originalCode;

async function setup() {
  await createSystemWallets();
  const a = await createUserWithWallet({ phone: '01711111111', nid: '1111111111' });
  const b = await createUserWithWallet({ phone: '01722222222', nid: '2222222222' });
  return { a, b };
}

describe('ledger under concurrency', () => {
  let a: Awaited<ReturnType<typeof setup>>['a'];
  let b: typeof a;
  beforeEach(async () => {
    await resetDb();
    ({ a, b } = await setup());
  });
  afterAll(() => prisma.$disconnect());

  // Review focus #1
  it('never overdraws: 20 parallel ৳100 spends from ৳1,000 → exactly 10 succeed', async () => {
    await fund(a.wallet.id, 100_000n, a.user.id);

    const results = await Promise.allSettled(
      times(20, () => postTransaction(transfer(a.wallet.id, b.wallet.id, 10_000n, a.user.id))),
    );

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect(rejected.map((r) => (r.reason as AppError).code)).toEqual(
      times(10, () => 'INSUFFICIENT_BALANCE'),
    );
    expect(await balanceOf(a.wallet.id)).toBe(0n);

    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: a.wallet.id },
      orderBy: { seq: 'asc' },
    });
    expect(entries.reduce((sum, e) => sum + e.amount, 0n)).toBe(0n);
    // 90_000n, 80_000n … 0n: each spend saw the balance the previous one left, no gaps or repeats.
    expect(entries.filter((e) => e.amount < 0n).map((e) => e.balanceAfter)).toEqual(
      times(10, (i) => BigInt(9 - i) * 10_000n),
    );
  });

  // Review focus #2
  it('never deadlocks: 30 parallel ৳10 transfers alternating A→B and B→A all succeed', async () => {
    await fund(a.wallet.id, 50_000n, a.user.id);
    await fund(b.wallet.id, 50_000n, b.user.id);

    const results = await Promise.allSettled(
      times(30, (i) =>
        postTransaction(
          i % 2 === 0
            ? transfer(a.wallet.id, b.wallet.id, 1_000n, a.user.id)
            : transfer(b.wallet.id, a.wallet.id, 1_000n, b.user.id),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    // 15 each way, so each is back where it started and the pair still holds ৳1,000.
    expect(await balanceOf(a.wallet.id)).toBe(50_000n);
    expect(await balanceOf(b.wallet.id)).toBe(50_000n);
  });

  // The control test: this is what postTransaction's ORDER BY id prevents.
  it(
    'control: locking "from" then "to" one at a time does deadlock (40P01)',
    { timeout: 30_000 },
    async () => {
      const lockFromThenTo = (from: string, to: string) =>
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${from}::uuid FOR NO KEY UPDATE`;
          await sleep(20);
          await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${to}::uuid FOR NO KEY UPDATE`;
        }, LEDGER_TX_OPTIONS);

      const results = await Promise.allSettled(
        times(10, (i) =>
          i % 2 === 0
            ? lockFromThenTo(a.wallet.id, b.wallet.id)
            : lockFromThenTo(b.wallet.id, a.wallet.id),
        ),
      );

      const deadlocks = results.filter(
        (r) => r.status === 'rejected' && postgresCode(r.reason) === '40P01',
      );
      expect(deadlocks.length).toBeGreaterThan(0);
    },
  );

  it('5 parallel requests with the same key → 1 new transaction and 4 replays', async () => {
    await fund(a.wallet.id, 10_000n, a.user.id);
    const input = transfer(a.wallet.id, b.wallet.id, 1_000n, a.user.id);

    const results = await Promise.all(times(5, () => postTransaction(input)));

    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(4);
    expect(new Set(results.map((r) => r.transaction.id)).size).toBe(1);
    expect(await balanceOf(a.wallet.id)).toBe(9_000n);
    expect(await balanceOf(b.wallet.id)).toBe(1_000n);
  });

  // Pins the order: were the key checked before the lock, the 4 retries would pass that check,
  // then wait for the lock and fail the balance check (422) instead of replaying.
  it('same-key parallel calls that spend the whole balance all succeed', async () => {
    await fund(a.wallet.id, 10_000n, a.user.id);
    const input = transfer(a.wallet.id, b.wallet.id, 10_000n, a.user.id);

    const results = await Promise.allSettled(times(5, () => postTransaction(input)));

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const values = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    expect(values.filter((r) => !r.replayed)).toHaveLength(1);
    expect(values.filter((r) => r.replayed)).toHaveLength(4);
    expect(new Set(values.map((r) => r.transaction.id)).size).toBe(1);
    expect(await balanceOf(a.wallet.id)).toBe(0n);
  });
});
