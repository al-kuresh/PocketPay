import type { PrismaClient, WalletType } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';

/** The proof that no money was created or lost. Money is a string of poisha. */
export interface ReconcileReport {
  ok: boolean;
  checkedWallets: number;
  checkedTransactions: number;
  walletMismatches: { walletId: string; type: WalletType; cached: string; ledger: string }[];
  lastBalanceMismatches: { walletId: string; cached: string; lastBalanceAfter: string }[];
  unbalancedTransactions: {
    transactionId: string;
    trxId: string;
    sum: string;
    entryCount: number;
  }[];
  /** SUM(all entries), must be "0". */
  ledgerTotal: string;
  /** SUM(all wallet balances), must be "0". */
  cachedTotal: string;
}

/**
 * Four SQL aggregates over the whole ledger, read-only. REPEATABLE READ: all four read the same
 * snapshot, so the report is consistent even while money is moving.
 */
export async function reconcileLedger(db: PrismaClient = prisma): Promise<ReconcileReport> {
  return db.$transaction(
    async (tx) => {
      // 1. Cached balance = sum of the wallet's entries. LEFT JOIN: a wallet with no entries must be 0.
      const walletMismatches = await tx.$queryRaw<ReconcileReport['walletMismatches']>`
    SELECT w.id AS "walletId", w.type::text AS type, w.balance::text AS cached,
           COALESCE(SUM(e.amount), 0)::text AS ledger
    FROM wallets w LEFT JOIN ledger_entries e ON e.wallet_id = w.id
    GROUP BY w.id
    HAVING w.balance <> COALESCE(SUM(e.amount), 0)
    ORDER BY w.id`;

      // 2. Cached balance = balance_after of the wallet's latest entry (highest seq, the true order).
      // Inner JOIN: wallets with no entries have no latest entry; check 1 already covers them.
      const lastBalanceMismatches = await tx.$queryRaw<ReconcileReport['lastBalanceMismatches']>`
    SELECT w.id AS "walletId", w.balance::text AS cached,
           last.balance_after::text AS "lastBalanceAfter"
    FROM wallets w
    JOIN (
      SELECT DISTINCT ON (wallet_id) wallet_id, balance_after
      FROM ledger_entries ORDER BY wallet_id, seq DESC
    ) last ON last.wallet_id = w.id
    WHERE last.balance_after <> w.balance
    ORDER BY w.id`;

      // 3. Every transaction's entries sum to 0 and number at least 2. FROM transactions LEFT JOIN:
      // a transaction with no entries at all is reported too (the zero-sum trigger only fires on
      // entry inserts, so the DB can't block that case).
      const unbalancedTransactions = await tx.$queryRaw<ReconcileReport['unbalancedTransactions']>`
    SELECT t.id AS "transactionId", t.trx_id AS "trxId",
           COALESCE(SUM(e.amount), 0)::text AS sum, COUNT(e.id)::int AS "entryCount"
    FROM transactions t LEFT JOIN ledger_entries e ON e.transaction_id = t.id
    GROUP BY t.id
    HAVING COALESCE(SUM(e.amount), 0) <> 0 OR COUNT(e.id) < 2
    ORDER BY t.id`;

      // 4. All entries sum to 0, and so do all cached balances (the float's negative balance is the
      // e-money it issued).
      const [totals] = await tx.$queryRaw<
        Pick<
          ReconcileReport,
          'checkedWallets' | 'checkedTransactions' | 'ledgerTotal' | 'cachedTotal'
        >[]
      >`
    SELECT (SELECT COUNT(*) FROM wallets)::int AS "checkedWallets",
           (SELECT COUNT(*) FROM transactions)::int AS "checkedTransactions",
           (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries)::text AS "ledgerTotal",
           (SELECT COALESCE(SUM(balance), 0) FROM wallets)::text AS "cachedTotal"`;
      if (!totals) throw new Error('reconcileLedger: totals query returned no row');

      return {
        ok:
          walletMismatches.length === 0 &&
          lastBalanceMismatches.length === 0 &&
          unbalancedTransactions.length === 0 &&
          totals.ledgerTotal === '0' &&
          totals.cachedTotal === '0',
        ...totals,
        walletMismatches,
        lastBalanceMismatches,
        unbalancedTransactions,
      };
    },
    // Full-table aggregates; this is an offline check, so a longer timeout is fine.
    { isolationLevel: 'RepeatableRead', timeout: 60_000 },
  );
}
