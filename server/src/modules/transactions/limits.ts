import type { LimitRule, WalletType } from '../../generated/prisma/client';
import { AppError } from '../../utils/AppError';
import { poishaToString } from '../../utils/money';
import { dhakaDayStart, dhakaMonthStart } from '../../utils/time';
import type { FlowType } from './flows';
import type { Db } from './rules';

/** The per-transaction minimum and maximum. No rule, no bounds; a NULL maximum is no maximum. */
export function checkAmountBounds(limit: LimitRule | null, amount: bigint): void {
  if (!limit) return;
  if (amount < limit.minAmount) {
    throw new AppError(422, 'AMOUNT_BELOW_MINIMUM', 'The amount is below the minimum', {
      min: poishaToString(limit.minAmount),
    });
  }
  if (limit.maxPerTxn !== null && amount > limit.maxPerTxn) {
    throw new AppError(422, 'AMOUNT_ABOVE_MAXIMUM', 'The amount is above the maximum', {
      max: poishaToString(limit.maxPerTxn),
    });
  }
}

/**
 * The daily and monthly count and amount limits (Asia/Dhaka days), counted on the customer's
 * wallet: the `side` of the flow it sits on. Only COMPLETED rows of the same type count.
 * Call it inside the ledger's `guard`: only there is the customer's wallet locked, so parallel
 * requests can't both pass. Checks DAY COUNT, DAY AMOUNT, MONTH COUNT, MONTH AMOUNT, in order.
 */
export async function checkPeriodLimits(
  db: Db,
  a: {
    type: FlowType;
    limit: LimitRule | null;
    customerWalletId: string;
    side: 'from' | 'to';
    amount: bigint;
    now: Date;
  },
): Promise<void> {
  const { limit } = a;
  if (!limit) return;
  // On the 'to' side (Cash In) the limit is the receiving customer's, and their totals aren't
  // the caller's business: the caller learns only that it's in the way.
  const exceeded = (...args: Parameters<typeof limitExceeded>) =>
    a.side === 'to' ? receiverLimitExceeded() : limitExceeded(...args);
  const periods = [
    {
      period: 'DAY',
      since: dhakaDayStart(a.now),
      maxCount: limit.maxCountDay,
      maxAmount: limit.maxAmountDay,
    },
    {
      period: 'MONTH',
      since: dhakaMonthStart(a.now),
      maxCount: limit.maxCountMonth,
      maxAmount: limit.maxAmountMonth,
    },
  ] as const;

  for (const { period, since, maxCount, maxAmount } of periods) {
    if (maxCount === null && maxAmount === null) continue;
    const used = await db.transaction.aggregate({
      where: {
        type: a.type,
        status: 'COMPLETED',
        ...(a.side === 'from'
          ? { fromWalletId: a.customerWalletId }
          : { toWalletId: a.customerWalletId }),
        createdAt: { gte: since },
      },
      _count: true,
      _sum: { amount: true },
    });
    const count = used._count;
    const sum = used._sum.amount ?? 0n;
    if (maxCount !== null && count + 1 > maxCount) {
      throw exceeded(period, 'COUNT', String(maxCount), String(count));
    }
    if (maxAmount !== null && sum + a.amount > maxAmount) {
      throw exceeded(period, 'AMOUNT', poishaToString(maxAmount), poishaToString(sum));
    }
  }
}

const limitExceeded = (
  period: 'DAY' | 'MONTH',
  kind: 'COUNT' | 'AMOUNT',
  limit: string,
  used: string,
) =>
  new AppError(
    422,
    'LIMIT_EXCEEDED',
    `This would go over your ${period === 'DAY' ? 'daily' : 'monthly'} ${kind === 'COUNT' ? 'transaction count' : 'amount'} limit`,
    { period, kind, limit, used },
  );

/** No details: which period, the limit or the totals would tell the caller about the receiver. */
const receiverLimitExceeded = () =>
  new AppError(
    422,
    'RECEIVER_LIMIT_EXCEEDED',
    "This customer can't receive this transaction right now",
  );

/** Only a CUSTOMER wallet is capped (design §6.4). Run it in the `guard`, on the locked balance. */
export function checkBalanceCap(a: {
  receiverType: WalletType;
  balance: bigint;
  credit: bigint;
  cap: bigint;
}): void {
  if (a.receiverType === 'CUSTOMER' && a.balance + a.credit > a.cap) {
    // No details: the receiver's balance is theirs, not the sender's business.
    throw new AppError(
      422,
      'RECEIVER_BALANCE_LIMIT',
      "The receiver's wallet can't hold this much money",
    );
  }
}
