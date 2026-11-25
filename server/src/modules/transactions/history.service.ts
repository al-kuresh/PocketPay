import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/AppError';
import { dhakaDateRange } from '../../utils/time';
import { type HistoryItem, type PublicReceipt, toHistoryItem, toReceipt } from './receipt.presenter';
import type { HistoryQuery } from './transactions.schemas';

const withUsers = { fromWallet: { include: { user: true } }, toWallet: { include: { user: true } } };

/**
 * The caller's ledger entries, newest first. Keyset pagination on `seq` (the true per-wallet
 * order): a page is `seq < cursor`, and one extra row says whether there is a next page.
 */
export async function listHistory(
  userId: string,
  q: HistoryQuery,
): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return { items: [], nextCursor: null }; // an admin has no wallet

  const rows = await prisma.ledgerEntry.findMany({
    where: {
      walletId: wallet.id,
      ...(q.cursor !== undefined && { seq: { lt: q.cursor } }),
      transaction: { type: q.type, createdAt: dhakaDateRange(q.from, q.to) },
    },
    orderBy: { seq: 'desc' },
    take: q.limit + 1,
    include: { transaction: { include: withUsers } },
  });

  const page = rows.slice(0, q.limit);
  const nextCursor = rows.length > q.limit ? page[page.length - 1]!.seq.toString() : null;
  return { items: page.map(toHistoryItem), nextCursor };
}

const notFound = () => new AppError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');

/** A receipt, only for a caller whose wallet has an entry in it: otherwise 404, like an unknown id. */
export async function getReceipt(userId: string, trxId: string): Promise<PublicReceipt> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  const t = wallet
    ? await prisma.transaction.findUnique({
        where: { trxId },
        include: { entries: true, ...withUsers },
      })
    : null;
  if (!wallet || !t || !t.entries.some((e) => e.walletId === wallet.id)) throw notFound();
  return toReceipt(t, { from: t.fromWallet.user, to: t.toWallet.user }, wallet.id);
}
