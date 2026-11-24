// The database's own guards on the money tables (raw SQL in migrations/*_ledger_core).
// These tests write with Prisma directly, skipping any service, to prove the DATABASE refuses
// bad data even when application code has a bug.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { resetDb } from './helpers/db';

const caught = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

const checkViolation = {
  code: 'P2039',
  meta: { driverAdapterError: { cause: { originalCode: '23514' } } },
};
const appendOnlyViolation = {
  code: 'P2039',
  meta: { driverAdapterError: { cause: { originalCode: 'P0001' } } },
};
const uniqueViolation = (index: string) => ({
  code: 'P2002',
  meta: { driverAdapterError: { cause: { constraint: { index } } } },
});

async function setup() {
  const user = await prisma.user.create({
    data: {
      phone: '01712345678',
      nidNumber: '1234567890',
      name: 'Test User',
      dateOfBirth: new Date('1995-06-15'),
      pinHash: 'not-a-real-hash',
      role: 'CUSTOMER',
    },
  });
  const customer = await prisma.wallet.create({ data: { userId: user.id, type: 'CUSTOMER' } });
  const fees = await prisma.wallet.create({ data: { type: 'SYSTEM_FEES' } });
  const float = await prisma.wallet.create({ data: { type: 'SYSTEM_FLOAT' } });
  return { user, customer, fees, float };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

const topup = (f: Fixture, overrides: { amount?: bigint; fee?: bigint } = {}) => ({
  trxId: 'PPTEST0001',
  type: 'FLOAT_TOPUP' as const,
  amount: 100n,
  fromWalletId: f.float.id,
  toWalletId: f.customer.id,
  initiatedById: f.user.id,
  idempotencyKey: 'key-1',
  ...overrides,
});

/** Writes a transaction with the given entries in one DB transaction (no balance updates). */
function post(f: Fixture, entries: { walletId: string; amount: bigint }[]) {
  return prisma.$transaction(async (tx) => {
    const t = await tx.transaction.create({ data: topup(f) });
    await tx.ledgerEntry.createMany({
      data: entries.map((e) => ({ transactionId: t.id, ...e, balanceAfter: e.amount })),
    });
    return t;
  });
}

describe('ledger database guards', () => {
  let f: Fixture;
  beforeEach(async () => {
    await resetDb();
    f = await setup();
  });
  afterAll(() => prisma.$disconnect());

  describe('wallets', () => {
    it('allows only one wallet per system type', async () => {
      const err = await caught(prisma.wallet.create({ data: { type: 'SYSTEM_FEES' } }));
      expect(err).toMatchObject(uniqueViolation('wallets_system_type_key'));
    });

    it.each(['customer', 'fees'] as const)(
      'refuses a negative balance on the %s wallet',
      async (w) => {
        const err = await caught(
          prisma.wallet.update({ where: { id: f[w].id }, data: { balance: -1n } }),
        );
        expect(err).toMatchObject(checkViolation);
      },
    );

    it('lets the SYSTEM_FLOAT wallet go negative', async () => {
      const updated = await prisma.wallet.update({
        where: { id: f.float.id },
        data: { balance: -5n },
      });
      expect(updated.balance).toBe(-5n);
    });

    it('refuses a CUSTOMER wallet without a user', async () => {
      const err = await caught(prisma.wallet.create({ data: { type: 'CUSTOMER' } }));
      expect(err).toMatchObject(checkViolation);
    });

    it('refuses a SYSTEM_FEES wallet that has a user', async () => {
      // A user with no wallet yet, so only the owner check can refuse this (not wallets_user_id_key).
      const other = await prisma.user.create({
        data: {
          phone: '01712345679',
          nidNumber: '1234567891',
          name: 'Other User',
          dateOfBirth: new Date('1995-06-15'),
          pinHash: 'not-a-real-hash',
          role: 'ADMIN',
        },
      });
      const err = await caught(
        prisma.wallet.create({ data: { userId: other.id, type: 'SYSTEM_FEES' } }),
      );
      expect(err).toMatchObject(checkViolation);
    });

    it('allows only one wallet per user', async () => {
      const err = await caught(
        prisma.wallet.create({ data: { userId: f.user.id, type: 'CUSTOMER' } }),
      );
      expect(err).toMatchObject(uniqueViolation('wallets_user_id_key'));
    });
  });

  describe('transactions and ledger entries', () => {
    it('rejects an unbalanced transaction at COMMIT and leaves nothing behind', async () => {
      await expect(post(f, [{ walletId: f.customer.id, amount: 100n }])).rejects.toThrow(
        /unbalanced transaction/,
      );
      expect(await prisma.transaction.count()).toBe(0);
      expect(await prisma.ledgerEntry.count()).toBe(0);
    });

    it('commits a balanced pair', async () => {
      await post(f, [
        { walletId: f.float.id, amount: -100n },
        { walletId: f.customer.id, amount: 100n },
      ]);
      expect(await prisma.transaction.count()).toBe(1);
      expect(await prisma.ledgerEntry.count()).toBe(2);
    });

    it('refuses to update or delete ledger entries', async () => {
      // The trigger is per row, so there must be rows for it to fire on.
      await post(f, [
        { walletId: f.float.id, amount: -100n },
        { walletId: f.customer.id, amount: 100n },
      ]);

      const updateErr = await caught(prisma.ledgerEntry.updateMany({ data: { amount: 0n } }));
      const deleteErr = await caught(prisma.ledgerEntry.deleteMany());

      expect(updateErr).toMatchObject(appendOnlyViolation);
      expect(deleteErr).toMatchObject(appendOnlyViolation);
      const amounts = (await prisma.ledgerEntry.findMany({ orderBy: { seq: 'asc' } })).map(
        (e) => e.amount,
      );
      expect(amounts).toEqual([-100n, 100n]);
    });

    it('refuses a transaction with a zero amount', async () => {
      const err = await caught(prisma.transaction.create({ data: topup(f, { amount: 0n }) }));
      expect(err).toMatchObject(checkViolation);
    });

    it('refuses a transaction with a negative fee', async () => {
      const err = await caught(prisma.transaction.create({ data: topup(f, { fee: -1n }) }));
      expect(err).toMatchObject(checkViolation);
    });
  });
});
