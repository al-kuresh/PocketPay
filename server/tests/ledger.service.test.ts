// postTransaction, one call at a time: balanced postings, balance checks, the guard hook,
// idempotency and trxId retries. Parallel behaviour is in ledger.concurrency.test.ts.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { postTransaction } from '../src/modules/ledger/ledger.service';
import type { LockedWallet, PostTransactionInput } from '../src/modules/ledger/ledger.types';
import { AppError } from '../src/utils/AppError';
import { resetDb } from './helpers/db';
import {
  balanceOf,
  createSystemWallets,
  createUserWithWallet,
  fund,
  transfer,
} from './helpers/wallets';

const TRX_ID = /^PP[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

const caught = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

async function setup() {
  const { fees, float } = await createSystemWallets();
  const alice = await createUserWithWallet({ phone: '01711111111', nid: '1111111111' });
  const bob = await createUserWithWallet({ phone: '01722222222', nid: '2222222222' });
  const agent = await createUserWithWallet({
    phone: '01733333333',
    nid: '3333333333',
    role: 'AGENT',
  });
  return { fees, float, alice, bob, agent };
}

describe('postTransaction', () => {
  let f: Awaited<ReturnType<typeof setup>>;
  /** Alice sends `amount` to Bob. */
  const aliceToBob = (amount: bigint, extra: Partial<PostTransactionInput> = {}) =>
    transfer(f.alice.wallet.id, f.bob.wallet.id, amount, f.alice.user.id, extra);

  beforeEach(async () => {
    await resetDb();
    f = await setup();
  });
  afterAll(() => prisma.$disconnect());

  it('funds ৳1,000 from the float with two balanced entries', async () => {
    const { transaction, replayed } = await fund(f.alice.wallet.id, 100_000n, f.alice.user.id);

    expect(replayed).toBe(false);
    expect(transaction.trxId).toMatch(TRX_ID);
    expect(transaction).toMatchObject({
      type: 'FLOAT_TOPUP',
      status: 'COMPLETED',
      amount: 100_000n,
      fee: 0n,
    });
    expect(transaction.entries).toHaveLength(2);
    expect(transaction.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletId: f.float.id,
          amount: -100_000n,
          balanceAfter: -100_000n,
        }),
        expect.objectContaining({
          walletId: f.alice.wallet.id,
          amount: 100_000n,
          balanceAfter: 100_000n,
        }),
      ]),
    );
    expect(await balanceOf(f.float.id)).toBe(-100_000n);
    expect(await balanceOf(f.alice.wallet.id)).toBe(100_000n);
  });

  it('posts the 3-way cash-out from design §8.3 (customer, agent, fees)', async () => {
    await fund(f.alice.wallet.id, 200_000n, f.alice.user.id);

    const { transaction } = await postTransaction(
      transfer(f.alice.wallet.id, f.agent.wallet.id, 100_000n, f.alice.user.id, {
        type: 'CASH_OUT',
        fee: 1_850n,
        postings: [
          { walletId: f.alice.wallet.id, amount: -101_850n },
          { walletId: f.agent.wallet.id, amount: 100_400n },
          { walletId: f.fees.id, amount: 1_450n },
        ],
      }),
    );

    expect(transaction.entries).toHaveLength(3);
    expect(await balanceOf(f.alice.wallet.id)).toBe(98_150n);
    expect(await balanceOf(f.agent.wallet.id)).toBe(100_400n);
    expect(await balanceOf(f.fees.id)).toBe(1_450n);
  });

  it('refuses to overdraw a wallet (422) and writes nothing', async () => {
    await fund(f.alice.wallet.id, 10_000n, f.alice.user.id);

    const err = await caught(postTransaction(aliceToBob(10_001n)));

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      statusCode: 422,
      code: 'INSUFFICIENT_BALANCE',
      details: undefined,
    });
    expect(await prisma.transaction.count()).toBe(1);
    expect(await balanceOf(f.alice.wallet.id)).toBe(10_000n);
    expect(await balanceOf(f.bob.wallet.id)).toBe(0n);
  });

  it('lets SYSTEM_FLOAT go negative but not SYSTEM_FEES', async () => {
    await fund(f.alice.wallet.id, 100n, f.alice.user.id);
    expect(await balanceOf(f.float.id)).toBe(-100n);

    const err = await caught(
      postTransaction(transfer(f.fees.id, f.bob.wallet.id, 100n, f.alice.user.id)),
    );

    expect(err).toMatchObject({ statusCode: 422, code: 'INSUFFICIENT_BALANCE' });
    expect(await balanceOf(f.fees.id)).toBe(0n);
  });

  it('answers 404 WALLET_NOT_FOUND for a wallet that does not exist', async () => {
    const err = await caught(
      postTransaction(transfer(f.alice.wallet.id, randomUUID(), 100n, f.alice.user.id)),
    );
    expect(err).toMatchObject({ statusCode: 404, code: 'WALLET_NOT_FOUND' });
  });

  describe('rejects invalid input before touching the database', () => {
    // Wallet ids that don't exist: had the DB been reached, this would be a 404 AppError.
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const valid = transfer(a, b, 100n, randomUUID());

    it.each<[string, Partial<PostTransactionInput>, RegExp]>([
      ['one posting', { postings: [{ walletId: a, amount: 0n }] }, /at least 2 postings/],
      [
        'postings that do not sum to 0',
        {
          postings: [
            { walletId: a, amount: -100n },
            { walletId: b, amount: 99n },
          ],
        },
        /sum to 0/,
      ],
      [
        'the same wallet twice',
        {
          postings: [
            { walletId: a, amount: -100n },
            { walletId: b, amount: 50n },
            { walletId: b, amount: 50n },
          ],
        },
        /only one posting/,
      ],
      [
        'no posting for the from wallet',
        {
          postings: [
            { walletId: c, amount: -100n },
            { walletId: b, amount: 100n },
          ],
        },
        /from and to/,
      ],
      [
        'a zero posting',
        {
          postings: [
            { walletId: a, amount: -100n },
            { walletId: b, amount: 100n },
            { walletId: c, amount: 0n },
          ],
        },
        /must not be 0/,
      ],
      [
        'the from wallet credited and the to wallet debited',
        {
          postings: [
            { walletId: a, amount: 100n },
            { walletId: b, amount: -100n },
          ],
        },
        /must be debited/,
      ],
      ['the same wallet as from and to', { toWalletId: a }, /different wallets/],
      ['a zero amount', { amount: 0n }, /amount must be > 0/],
      ['a negative fee', { fee: -1n }, /fee must be >= 0/],
      ['an empty idempotency key', { idempotencyKey: '' }, /idempotencyKey/],
      ['a 101-character idempotency key', { idempotencyKey: 'k'.repeat(101) }, /idempotencyKey/],
      ['a 51-character note', { note: 'n'.repeat(51) }, /note/],
    ])('%s', async (_, override, message) => {
      const err = await caught(postTransaction({ ...valid, ...override }));
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(AppError);
      expect((err as Error).message).toMatch(message);
    });
  });

  describe('guard', () => {
    it('receives the locked wallets with their balances', async () => {
      await fund(f.alice.wallet.id, 5_000n, f.alice.user.id);
      let seen: ReadonlyMap<string, Readonly<LockedWallet>> | undefined;

      await postTransaction(
        aliceToBob(1_000n, {
          guard: async ({ wallets }) => {
            seen = wallets;
          },
        }),
      );

      expect(seen?.get(f.alice.wallet.id)).toEqual({
        id: f.alice.wallet.id,
        type: 'CUSTOMER',
        balance: 5_000n,
      });
      expect(seen?.get(f.bob.wallet.id)).toEqual({
        id: f.bob.wallet.id,
        type: 'CUSTOMER',
        balance: 0n,
      });
    });

    it('aborts everything when it throws, and its error comes back', async () => {
      await fund(f.alice.wallet.id, 5_000n, f.alice.user.id);
      const thrown = new AppError(403, 'TEST', 'x');

      const err = await caught(
        postTransaction(
          aliceToBob(1_000n, {
            guard: async () => {
              throw thrown;
            },
          }),
        ),
      );

      expect(err).toBe(thrown);
      expect(await prisma.transaction.count()).toBe(1);
      expect(await prisma.ledgerEntry.count()).toBe(2);
      expect(await balanceOf(f.alice.wallet.id)).toBe(5_000n);
    });

    it("can't change the balances the ledger checks and writes", async () => {
      await fund(f.alice.wallet.id, 5_000n, f.alice.user.id);

      const err = await caught(
        postTransaction(
          aliceToBob(10_000n, {
            guard: async ({ wallets }) => {
              // A buggy guard: if this worked, Alice could spend ৳100 she doesn't have.
              (wallets.get(f.alice.wallet.id) as LockedWallet).balance = 1_000_000n;
            },
          }),
        ),
      );

      expect(err).toBeInstanceOf(TypeError);
      expect(await prisma.transaction.count()).toBe(1);
      expect(await balanceOf(f.alice.wallet.id)).toBe(5_000n);
      expect(await balanceOf(f.bob.wallet.id)).toBe(0n);
    });

    it('gets its own copy of the map, so changing the map does not change the posting', async () => {
      await fund(f.alice.wallet.id, 5_000n, f.alice.user.id);

      await postTransaction(
        aliceToBob(1_000n, {
          guard: async ({ wallets }) => {
            (wallets as Map<string, LockedWallet>).delete(f.bob.wallet.id);
          },
        }),
      );

      expect(await balanceOf(f.alice.wallet.id)).toBe(4_000n);
      expect(await balanceOf(f.bob.wallet.id)).toBe(1_000n);
    });
  });

  describe('idempotency', () => {
    it('replays the same request instead of moving money twice', async () => {
      await fund(f.alice.wallet.id, 10_000n, f.alice.user.id);
      const input = aliceToBob(1_000n);

      const first = await postTransaction(input);
      const second = await postTransaction(input);

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.transaction.id).toBe(first.transaction.id);
      expect(second.transaction.entries).toHaveLength(2);
      expect(await balanceOf(f.alice.wallet.id)).toBe(9_000n);
      expect(await balanceOf(f.bob.wallet.id)).toBe(1_000n);
    });

    // Review focus #3: a retry that changed must never silently get the first transaction back.
    it.each(['amount', 'receiver', 'type'] as const)(
      'refuses the same key with a different %s (409)',
      async (changed) => {
        await fund(f.alice.wallet.id, 10_000n, f.alice.user.id);
        const idempotencyKey = randomUUID();
        await postTransaction(aliceToBob(1_000n, { idempotencyKey }));

        const retry = transfer(
          f.alice.wallet.id,
          changed === 'receiver' ? f.agent.wallet.id : f.bob.wallet.id,
          changed === 'amount' ? 2_000n : 1_000n,
          f.alice.user.id,
          { idempotencyKey, ...(changed === 'type' && { type: 'PAYMENT' as const }) },
        );
        const err = await caught(postTransaction(retry));

        expect(err).toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
        expect(await balanceOf(f.alice.wallet.id)).toBe(9_000n);
      },
    );

    describe('unique-index backstop (if the check after the locks were ever bypassed)', () => {
      // The guard runs after the idempotency check, so a row it commits from ANOTHER connection
      // is missed by that check and only the unique index catches it. That insert's FK checks
      // (FOR KEY SHARE) get through because the ledger locks wallets FOR NO KEY UPDATE.
      const commitBehindTheLedger = (input: PostTransactionInput, amount: bigint) => async () => {
        await prisma.transaction.create({
          data: {
            trxId: 'PPBACKSTOP',
            type: input.type,
            amount,
            fromWalletId: input.fromWalletId,
            toWalletId: input.toWalletId,
            initiatedById: input.initiatedById,
            idempotencyKey: input.idempotencyKey,
          },
        });
      };

      it('returns the existing transaction when it is the same request', async () => {
        await fund(f.alice.wallet.id, 10_000n, f.alice.user.id);
        const input = aliceToBob(1_000n);

        const result = await postTransaction({
          ...input,
          guard: commitBehindTheLedger(input, 1_000n),
        });

        expect(result.replayed).toBe(true);
        expect(result.transaction.trxId).toBe('PPBACKSTOP');
        expect(await balanceOf(f.alice.wallet.id)).toBe(10_000n);
      });

      it('answers 409 when it is a different request', async () => {
        await fund(f.alice.wallet.id, 10_000n, f.alice.user.id);
        const input = aliceToBob(1_000n);

        const err = await caught(
          postTransaction({ ...input, guard: commitBehindTheLedger(input, 2_000n) }),
        );

        expect(err).toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
        expect(await balanceOf(f.alice.wallet.id)).toBe(10_000n);
      });
    });
  });

  describe('trxId collisions', () => {
    it('retries with a new trxId when the generated one already exists', async () => {
      const { transaction: existing } = await fund(f.alice.wallet.id, 10_000n, f.alice.user.id);
      let calls = 0;

      const { transaction } = await postTransaction(aliceToBob(1_000n), {
        nextTrxId: () => (calls++ === 0 ? existing.trxId : 'PPZZZZZZZZ'),
      });

      expect(transaction.trxId).toBe('PPZZZZZZZZ');
      expect(await balanceOf(f.alice.wallet.id)).toBe(9_000n);
    });

    it('gives up after 3 attempts and rethrows the P2002', async () => {
      const { transaction: existing } = await fund(f.alice.wallet.id, 10_000n, f.alice.user.id);
      let calls = 0;

      const err = await caught(
        postTransaction(aliceToBob(1_000n), {
          nextTrxId: () => {
            calls++;
            return existing.trxId;
          },
        }),
      );

      expect(calls).toBe(3);
      expect(err).toMatchObject({ code: 'P2002' });
      expect(await balanceOf(f.alice.wallet.id)).toBe(10_000n);
    });
  });

  it('chains balanceAfter in seq order, ending at the cached balance', async () => {
    await fund(f.alice.wallet.id, 100_000n, f.alice.user.id);
    await fund(f.alice.wallet.id, 50_000n, f.alice.user.id);
    await postTransaction(aliceToBob(30_000n));

    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: f.alice.wallet.id },
      orderBy: { seq: 'asc' },
    });

    expect(entries.map((e) => e.balanceAfter)).toEqual([100_000n, 150_000n, 120_000n]);
    expect(await balanceOf(f.alice.wallet.id)).toBe(120_000n);
  });
});
