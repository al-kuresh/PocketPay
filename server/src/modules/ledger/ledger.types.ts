import type {
  LedgerEntry,
  Prisma,
  Transaction,
  TransactionType,
  WalletType,
} from '../../generated/prisma/client';

/** One wallet's side of a transaction. Signed: − money out, + money in. */
export interface Posting {
  walletId: string;
  amount: bigint;
}

/** A wallet row as read by the lock query, held FOR NO KEY UPDATE until the transaction ends. */
export interface LockedWallet {
  id: string;
  type: WalletType;
  balance: bigint;
}

export interface PostTransactionInput {
  type: TransactionType;
  /** > 0, the business amount (e.g. what the receiver gets). */
  amount: bigint;
  /** >= 0 */
  fee: bigint;
  fromWalletId: string;
  toWalletId: string;
  /** ≥ 2, distinct wallets, include from and to, sum === 0n. */
  postings: Posting[];
  initiatedById: string;
  /** 1–100 chars. Unique per from wallet. */
  idempotencyKey: string;
  /** ≤ 50 chars. */
  note?: string;
  /** Runs inside the transaction after the locks are taken and before anything is written.
   *  Phase 5 puts status, limit and balance-cap checks here. Throwing aborts everything. */
  guard?: (ctx: {
    tx: Prisma.TransactionClient;
    wallets: Map<string, LockedWallet>;
  }) => Promise<void>;
}

export interface PostTransactionResult {
  transaction: Transaction & { entries: LedgerEntry[] };
  /** true when an earlier transaction with the same key was returned. */
  replayed: boolean;
}
