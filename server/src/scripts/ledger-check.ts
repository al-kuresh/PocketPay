// npm run ledger:check: runs reconcileLedger() and prints a readable summary.
// Exit code 1 when the ledger doesn't balance, so CI or a cron job can alert on it.
import 'dotenv/config'; // must be first: loads .env before env.ts reads process.env
import { prisma } from '../lib/prisma';
import { reconcileLedger } from '../modules/ledger/reconcile';

/** Poisha → "৳1,00,000.00" (Bangladeshi digit grouping). */
function formatTaka(poisha: bigint | string): string {
  const p = BigInt(poisha);
  const abs = p < 0n ? -p : p;
  const whole = new Intl.NumberFormat('en-IN').format(abs / 100n);
  return `${p < 0n ? '-' : ''}৳${whole}.${(abs % 100n).toString().padStart(2, '0')}`;
}

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
