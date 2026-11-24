import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { violatedUniqueIndex } from '../../lib/prismaErrors';
import { AppError } from '../../utils/AppError';
import { generateTrxId } from '../../utils/trxId';
import type { LockedWallet, PostTransactionInput, PostTransactionResult } from './ledger.types';

// READ COMMITTED (the default) plus the row locks is correct; SERIALIZABLE is not needed.
export const LEDGER_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
const TRX_ID_ATTEMPTS = 3;

const walletNotFound = () => new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
const insufficientBalance = () => new AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
const keyReused = () =>
  new AppError(
    409,
    'IDEMPOTENCY_KEY_REUSED',
    'This request key was already used for a different transaction',
  );

/** Bad input here is a bug in the calling code, not the user's fault: a plain Error (500). */
function validate(input: PostTransactionInput): void {
  const fail = (problem: string): never => {
    throw new Error(`postTransaction: ${problem}`);
  };
  const { postings } = input;
  const ids = new Set(postings.map((p) => p.walletId));

  if (postings.length < 2) fail('needs at least 2 postings');
  if (ids.size !== postings.length) fail('each wallet may have only one posting');
  if (input.fromWalletId === input.toWalletId) fail('from and to must be different wallets');
  if (!ids.has(input.fromWalletId) || !ids.has(input.toWalletId)) {
    fail('the from and to wallets must both have a posting');
  }
  if (postings.some((p) => p.amount === 0n)) fail('posting amounts must not be 0');
  if (postings.reduce((sum, p) => sum + p.amount, 0n) !== 0n) fail('postings must sum to 0');
  if (input.amount <= 0n) fail('amount must be > 0');
  if (input.fee < 0n) fail('fee must be >= 0');
  if (input.idempotencyKey.length < 1 || input.idempotencyKey.length > 100) {
    fail('idempotencyKey must be 1-100 characters');
  }
  if (input.note !== undefined && input.note.length > 50)
    fail('note must be at most 50 characters');
}

const findByKey = (db: Prisma.TransactionClient, input: PostTransactionInput) =>
  db.transaction.findUnique({
    where: {
      fromWalletId_idempotencyKey: {
        fromWalletId: input.fromWalletId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    include: { entries: { orderBy: { seq: 'asc' } } },
  });

/** An earlier transaction with this key: the same request again is a replay, anything else a 409. */
function replay(
  existing: PostTransactionResult['transaction'],
  input: PostTransactionInput,
): PostTransactionResult {
  const same =
    existing.type === input.type &&
    existing.amount === input.amount &&
    existing.toWalletId === input.toWalletId;
  if (!same) throw keyReused();
  return { transaction: existing, replayed: true };
}

async function post(
  tx: Prisma.TransactionClient,
  input: PostTransactionInput,
  trxId: string,
): Promise<PostTransactionResult> {
  const ids = input.postings.map((p) => p.walletId);

  // ORDER BY id: every transaction locks wallets in the same global order, so two transfers
  // between the same wallets in opposite directions can't deadlock. See ledger.concurrency.test.ts.
  // FOR NO KEY UPDATE (the lock a plain UPDATE takes) serializes money ops on a wallet without
  // blocking other sessions' FK checks (FOR KEY SHARE) on it, as FOR UPDATE would.
  const rows = await tx.$queryRaw<LockedWallet[]>`
    SELECT id, type::text AS type, balance FROM wallets
    WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
  const wallets = new Map(rows.map((w) => [w.id, w]));
  if (ids.some((id) => !wallets.has(id))) throw walletNotFound();

  // Only now, under the locks: a parallel request with the same key waited on the "from" lock
  // above, and this read (a new snapshot under READ COMMITTED) sees what it committed.
  const existing = await findByKey(tx, input);
  if (existing) return replay(existing, input);

  await input.guard?.({ tx, wallets });

  const entries = input.postings.map((p) => {
    const wallet = wallets.get(p.walletId)!; // present: checked right after the lock
    const balanceAfter = wallet.balance + p.amount;
    if (balanceAfter < 0n && wallet.type !== 'SYSTEM_FLOAT') throw insufficientBalance();
    return { walletId: p.walletId, amount: p.amount, balanceAfter };
  });

  const transaction = await tx.transaction.create({
    data: {
      trxId,
      type: input.type,
      amount: input.amount,
      fee: input.fee,
      fromWalletId: input.fromWalletId,
      toWalletId: input.toWalletId,
      initiatedById: input.initiatedById,
      idempotencyKey: input.idempotencyKey,
      note: input.note,
    },
  });
  const created = await tx.ledgerEntry.createManyAndReturn({
    data: entries.map((e) => ({ ...e, transactionId: transaction.id })),
  });
  // The exact value, not an increment: the row is locked and balanceAfter was computed from it.
  for (const e of entries) {
    await tx.wallet.update({ where: { id: e.walletId }, data: { balance: e.balanceAfter } });
  }
  return { transaction: { ...transaction, entries: created }, replayed: false };
}

/**
 * The only way money moves: locks the wallets, checks idempotency and balances, and writes
 * balanced ledger entries plus the cached balances, all in one DB transaction.
 */
export async function postTransaction(
  input: PostTransactionInput,
  options: { nextTrxId?: () => string } = {}, // tests only: inject trxId collisions
): Promise<PostTransactionResult> {
  validate(input);
  const nextTrxId = options.nextTrxId ?? generateTrxId;

  for (let attempt = 1; ; attempt++) {
    try {
      const trxId = nextTrxId();
      return await prisma.$transaction((tx) => post(tx, input, trxId), LEDGER_TX_OPTIONS);
    } catch (err) {
      const index = violatedUniqueIndex(err);
      // A random trxId that already exists: run the whole thing again with a fresh one.
      if (index === 'transactions_trx_id_key' && attempt < TRX_ID_ATTEMPTS) continue;
      // Backstop: only reachable if the check under the locks was bypassed. The failed
      // transaction is gone, so re-read outside it.
      if (index === 'transactions_from_wallet_id_idempotency_key_key') {
        const existing = await findByKey(prisma, input);
        if (existing) return replay(existing, input);
      }
      throw err;
    }
  }
}
