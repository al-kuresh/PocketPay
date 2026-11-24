// npm run db:seed (prisma db seed): system wallets, rules and the demo accounts. Safe to re-run.
import 'dotenv/config'; // must be first: loads .env before env.ts reads process.env
import { formatTaka } from '../src/utils/money';

if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'Demo seeding is disabled in production; Phase 10 decides how the live demo is seeded',
  );
}

// Imported after the check, so a production run stops before it ever connects to the database.
const { DEMO_PIN, seedAll } = await import('../src/db/seed');
const { prisma } = await import('../src/lib/prisma');

try {
  const { users, fees, float, report } = await seedAll();
  console.log(`Seeded. Ledger: ${report.checkedTransactions} transactions, balanced.`);
  console.log(`Demo accounts (PIN ${DEMO_PIN} for all):`);
  for (const u of Object.values(users)) {
    const wallet = await prisma.wallet.findUnique({ where: { userId: u.id } });
    const balance = wallet ? formatTaka(wallet.balance) : 'no wallet';
    console.log(`  ${u.phone}  ${u.role.padEnd(8)}  ${u.name.padEnd(12)}  ${balance}`);
  }
  // Re-read: seedSystem returned the wallets before the demo money moved.
  const [f, fl] = await Promise.all(
    [fees, float].map((w) => prisma.wallet.findUniqueOrThrow({ where: { id: w.id } })),
  );
  console.log(`  SYSTEM_FEES   ${formatTaka(f!.balance)}`);
  console.log(`  SYSTEM_FLOAT  ${formatTaka(fl!.balance)}`);
} finally {
  await prisma.$disconnect();
}
