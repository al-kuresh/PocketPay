import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import type { FlowType } from './flows';

/** The shared client, or the ledger's transaction client inside a `guard`. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** The flow's fee and limit rules. A missing row is `null`: no fee, no limits. */
export async function loadRules(db: Db, type: FlowType) {
  // One after the other: on a transaction client the queries share one connection anyway.
  const fee = await db.feeRule.findUnique({ where: { type } });
  const limit = await db.limitRule.findUnique({ where: { type } });
  return { fee, limit };
}

/** The customer balance cap in poisha. A missing row is a setup bug (run the seed), not "no cap". */
export async function loadCustomerMaxBalance(db: Db): Promise<bigint> {
  const row = await db.systemSetting.findUnique({ where: { key: 'CUSTOMER_MAX_BALANCE' } });
  if (!row) throw new Error('system_settings has no CUSTOMER_MAX_BALANCE row: run the seed');
  // BigInt() would read '' as 0n (a cap of ৳0) and accept ' 5', '0x10' or '1e3'.
  if (!/^\d+$/.test(row.value)) {
    throw new Error(`system_settings CUSTOMER_MAX_BALANCE must be poisha digits, got "${row.value}"`);
  }
  return BigInt(row.value);
}
