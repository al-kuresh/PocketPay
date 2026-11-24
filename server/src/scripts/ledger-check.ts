// npm run ledger:check: runs reconcileLedger() and prints a readable summary.
// Exit code 1 when the ledger doesn't balance, so CI or a cron job can alert on it.
import 'dotenv/config'; // must be first: loads .env before env.ts reads process.env
import { prisma } from '../lib/prisma';
import { reconcileLedger } from '../modules/ledger/reconcile';
import { formatTaka } from '../utils/money';

try {
  const r = await reconcileLedger();
  // The float's balance is minus the e-money in circulation.
  const float = await prisma.wallet.findFirst({ where: { type: 'SYSTEM_FLOAT' } });

  console.log(`Ledger check: ${r.ok ? 'OK' : 'FAILED'}`);
  console.log(
    `  ${formatTaka(-(float?.balance ?? 0n))} in ${r.checkedWallets} wallets, ` +
      `${r.checkedTransactions} transactions`,
  );
  console.log(
    `  all entries sum to ${formatTaka(r.ledgerTotal)}, all balances to ${formatTaka(r.cachedTotal)}` +
      ' (both must be ৳0.00)',
  );
  for (const m of r.walletMismatches) {
    console.log(
      `  ✗ wallet ${m.walletId} (${m.type}): balance ${formatTaka(m.cached)}, ` +
        `its entries sum to ${formatTaka(m.ledger)}`,
    );
  }
  for (const m of r.lastBalanceMismatches) {
    console.log(
      `  ✗ wallet ${m.walletId}: balance ${formatTaka(m.cached)}, ` +
        `its latest entry says ${formatTaka(m.lastBalanceAfter)}`,
    );
  }
  for (const b of r.chainBreaks) {
    console.log(
      `  ✗ wallet ${b.walletId}: entry #${b.seq} says balance ${formatTaka(b.balanceAfter)}, ` +
        `expected ${formatTaka(b.expected)} from the entry before it`,
    );
  }
  for (const t of r.unbalancedTransactions) {
    console.log(
      `  ✗ transaction ${t.trxId} (${t.transactionId}): ${t.entryCount} entries ` +
        `summing to ${formatTaka(t.sum)}`,
    );
  }
  if (!r.ok) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
