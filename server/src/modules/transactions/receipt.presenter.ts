import type {
  LedgerEntry,
  Transaction,
  TransactionStatus,
  TransactionType,
  User,
} from '../../generated/prisma/client';
import { poishaToString } from '../../utils/money';
import { type Party, toParty } from './parties';

/** A transaction as its caller sees it. Money is a poisha string. */
export interface PublicReceipt {
  trxId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  fee: string;
  note: string | null;
  createdAt: string; // ISO
  from: Party;
  to: Party;
  /** The caller's own signed ledger entry, e.g. "-50500" for the sender of ৳500 + ৳5 fee. */
  mine: { amount: string; balanceAfter: string };
}

export function toReceipt(
  t: Transaction & { entries: LedgerEntry[] },
  parties: { from: User | null; to: User | null },
  myWalletId: string,
): PublicReceipt {
  const mine = t.entries.find((e) => e.walletId === myWalletId);
  // A caller outside the transaction must never get here: a bug, not a 404.
  if (!mine) throw new Error(`toReceipt: wallet ${myWalletId} has no entry in ${t.trxId}`);
  return {
    trxId: t.trxId,
    type: t.type,
    status: t.status,
    amount: poishaToString(t.amount),
    fee: poishaToString(t.fee),
    note: t.note,
    createdAt: t.createdAt.toISOString(),
    from: toParty(parties.from),
    to: toParty(parties.to),
    mine: { amount: poishaToString(mine.amount), balanceAfter: poishaToString(mine.balanceAfter) },
  };
}
