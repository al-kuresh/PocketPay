// reconcileLedger: the five SQL checks that prove no money was created or lost, and the
// ledger:check script that runs them from the command line. Tampering is done with direct
// SQL/Prisma writes, skipping postTransaction, the way a bug or a manual edit would.
import { spawnSync } from 'node:child_process';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '../src/generated/prisma/client';
import { prisma } from '../src/lib/prisma';
import { postTransaction } from '../src/modules/ledger/ledger.service';
import { reconcileLedger } from '../src/modules/ledger/reconcile';
import { resetDb } from './helpers/db';
import { createSystemWallets, createUserWithWallet, fund } from './helpers/wallets';

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
type Fixture = Awaited<ReturnType<typeof setup>>;

let trxCounter = 0;
/** A transactions row with exactly these entries, written directly (no locks, no balance updates). */
function writeRaw(
  f: Fixture,
  entries: { walletId: string; amount: bigint; balanceAfter: bigint; createdAt?: Date }[],
) {
  return prisma.$transaction(async (tx) => {
    trxCounter += 1;
    const t = await tx.transaction.create({
      data: {
        trxId: `PPRAW${String(trxCounter).padStart(5, '0')}`,
        type: 'FLOAT_TOPUP',
        amount: 100n,
        fromWalletId: f.float.id,
        toWalletId: f.alice.wallet.id,
        initiatedById: f.alice.user.id,
        idempotencyKey: `raw-${trxCounter}`,
      },
    });
    await tx.ledgerEntry.createMany({ data: entries.map((e) => ({ ...e, transactionId: t.id })) });
    return t;
  });
}

const setBalance = (walletId: string, balance: bigint) =>
  prisma.wallet.update({ where: { id: walletId }, data: { balance } });

const runCheck = () =>
  spawnSync('npx', ['tsx', 'src/scripts/ledger-check.ts'], {
    env: process.env, // the test DB URL and JWT_SECRET that Vitest set
    encoding: 'utf8',
  });

describe('reconcileLedger', () => {
  let f: Fixture;

  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('passes on an empty database', async () => {
    expect(await reconcileLedger()).toEqual({
      ok: true,
      checkedWallets: 0,
      checkedTransactions: 0,
      walletMismatches: [],
      lastBalanceMismatches: [],
      chainBreaks: [],
      unbalancedTransactions: [],
      ledgerTotal: '0',
      cachedTotal: '0',
    });
  });

  it('passes for fresh wallets that have no entries yet (balance 0)', async () => {
    await setup();
    expect(await reconcileLedger()).toMatchObject({
      ok: true,
      checkedWallets: 5,
      walletMismatches: [],
      lastBalanceMismatches: [],
    });
  });

  describe('with postings', () => {
    beforeEach(async () => {
      f = await setup();
    });

    it('passes after real postTransaction calls', async () => {
      await fund(f.alice.wallet.id, 200_000n, f.alice.user.id);
      await fund(f.bob.wallet.id, 50_000n, f.bob.user.id);
      // The cash-out from design §8.3: customer −101_850n, agent +100_400n, fees +1_450n.
      await postTransaction({
        type: 'CASH_OUT',
        amount: 100_000n,
        fee: 1_850n,
        fromWalletId: f.alice.wallet.id,
        toWalletId: f.agent.wallet.id,
        postings: [
          { walletId: f.alice.wallet.id, amount: -101_850n },
          { walletId: f.agent.wallet.id, amount: 100_400n },
          { walletId: f.fees.id, amount: 1_450n },
        ],
        initiatedById: f.alice.user.id,
        idempotencyKey: 'cash-out-1',
      });

      expect(await reconcileLedger()).toEqual({
        ok: true,
        checkedWallets: 5,
        checkedTransactions: 3,
        walletMismatches: [],
        lastBalanceMismatches: [],
        chainBreaks: [],
        unbalancedTransactions: [],
        ledgerTotal: '0',
        cachedTotal: '0',
      });
    });

    it('reports a cached balance changed behind the ledger’s back (review focus #4)', async () => {
      await fund(f.alice.wallet.id, 100_000n, f.alice.user.id);
      await prisma.$executeRaw`UPDATE wallets SET balance = balance + 5000 WHERE id = ${f.alice.wallet.id}::uuid`;

      const report = await reconcileLedger();
      expect(report.ok).toBe(false);
      expect(report.walletMismatches).toEqual([
        { walletId: f.alice.wallet.id, type: 'CUSTOMER', cached: '105000', ledger: '100000' },
      ]);
      expect(report.lastBalanceMismatches).toEqual([
        { walletId: f.alice.wallet.id, cached: '105000', lastBalanceAfter: '100000' },
      ]);
      expect(report.cachedTotal).toBe('5000');
      expect(report.ledgerTotal).toBe('0');
    });

    it('reports a wrong balance_after on the latest entry even when the sums agree', async () => {
      await writeRaw(f, [
        { walletId: f.float.id, amount: -100n, balanceAfter: -100n },
        { walletId: f.alice.wallet.id, amount: 100n, balanceAfter: 999n },
      ]);
      await setBalance(f.float.id, -100n);
      await setBalance(f.alice.wallet.id, 100n);

      const report = await reconcileLedger();
      expect(report.ok).toBe(false);
      expect(report.walletMismatches).toEqual([]);
      expect(report.lastBalanceMismatches).toEqual([
        { walletId: f.alice.wallet.id, cached: '100', lastBalanceAfter: '999' },
      ]);
    });

    it('reports a broken balance_after chain even when the sums and the latest entry agree', async () => {
      await writeRaw(f, [
        { walletId: f.float.id, amount: -100n, balanceAfter: -100n },
        { walletId: f.alice.wallet.id, amount: 100n, balanceAfter: 100n },
      ]);
      await writeRaw(f, [
        { walletId: f.float.id, amount: -50n, balanceAfter: -150n },
        { walletId: f.alice.wallet.id, amount: 50n, balanceAfter: 999n }, // should be 150
      ]);
      await writeRaw(f, [
        { walletId: f.float.id, amount: -10n, balanceAfter: -160n },
        { walletId: f.alice.wallet.id, amount: 10n, balanceAfter: 160n },
      ]);
      await setBalance(f.float.id, -160n);
      await setBalance(f.alice.wallet.id, 160n);

      const report = await reconcileLedger();
      expect(report.walletMismatches).toEqual([]);
      expect(report.lastBalanceMismatches).toEqual([]);
      expect(report.ok).toBe(false);
      // The bad entry, and the next one (whose previous balance is the bad 999).
      expect(report.chainBreaks.map((b) => [b.walletId, b.balanceAfter, b.expected])).toEqual([
        [f.alice.wallet.id, '999', '150'],
        [f.alice.wallet.id, '160', '1009'],
      ]);
    });

    it('takes the latest entry by seq, not created_at (started first, committed second)', async () => {
      await writeRaw(f, [
        { walletId: f.float.id, amount: -100n, balanceAfter: -100n },
        { walletId: f.alice.wallet.id, amount: 100n, balanceAfter: 100n },
      ]);
      // Committed second (higher seq) but its DB transaction started earlier.
      const startedEarlier = new Date('2000-01-01T00:00:00Z');
      await writeRaw(f, [
        { walletId: f.float.id, amount: -50n, balanceAfter: -150n, createdAt: startedEarlier },
        { walletId: f.alice.wallet.id, amount: 50n, balanceAfter: 150n, createdAt: startedEarlier },
      ]);
      await setBalance(f.float.id, -150n);
      await setBalance(f.alice.wallet.id, 150n);

      expect(await reconcileLedger()).toMatchObject({ ok: true, lastBalanceMismatches: [] });
    });

    it('reports a transaction whose entries do not sum to 0', async () => {
      // The zero-sum trigger blocks this, so switch it off just for this insert.
      await prisma.$executeRaw`ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_sum_zero`;
      let t: Transaction;
      try {
        t = await writeRaw(f, [
          { walletId: f.float.id, amount: -100n, balanceAfter: -100n },
          { walletId: f.alice.wallet.id, amount: 90n, balanceAfter: 90n },
        ]);
      } finally {
        await prisma.$executeRaw`ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_sum_zero`;
      }

      const report = await reconcileLedger();
      expect(report.ok).toBe(false);
      expect(report.unbalancedTransactions).toEqual([
        { transactionId: t.id, trxId: t.trxId, sum: '-10', entryCount: 2 },
      ]);
      expect(report.ledgerTotal).toBe('-10');
    });

    it('reports a transaction with no entries at all (the trigger only fires on entry inserts)', async () => {
      const t = await writeRaw(f, []);

      const report = await reconcileLedger();
      expect(report.ok).toBe(false);
      expect(report.unbalancedTransactions).toEqual([
        { transactionId: t.id, trxId: t.trxId, sum: '0', entryCount: 0 },
      ]);
      expect(report.checkedTransactions).toBe(1);
    });

    it(
      'ledger:check exits 0 on a clean ledger and 1 after tampering',
      { timeout: 60_000 },
      async () => {
        await fund(f.alice.wallet.id, 100_000n, f.alice.user.id);

        const clean = runCheck();
        expect(clean.status, clean.stderr).toBe(0);
        expect(clean.stdout).toContain('৳1,000.00');

        await prisma.$executeRaw`UPDATE wallets SET balance = balance + 5000 WHERE id = ${f.alice.wallet.id}::uuid`;
        const tampered = runCheck();
        expect(tampered.status, tampered.stderr).toBe(1);
        expect(tampered.stdout).toContain(f.alice.wallet.id);
      },
    );
  });
});
