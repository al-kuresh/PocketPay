import type { Posting } from '../ledger/ledger.types';
import { FLOWS, type FlowType } from './flows';

/** The ledger postings for one flow, per the flow table. Sums to 0n; a zero fees posting is left out. */
export function buildPostings(
  type: FlowType,
  w: { fromWalletId: string; toWalletId: string; feesWalletId: string },
  m: { amount: bigint; fee: bigint; commission: bigint },
): Posting[] {
  const { amount, fee, commission } = m;
  if (commission !== 0n && type !== 'CASH_OUT') {
    throw new Error(`Only CASH_OUT pays a commission, got ${commission} on ${type}`);
  }
  const [out, received, toFees] =
    FLOWS[type].feePaidBy === 'receiver'
      ? [amount, amount - fee, fee]
      : [amount + fee, amount + commission, fee - commission];
  const postings: Posting[] = [
    { walletId: w.fromWalletId, amount: -out },
    { walletId: w.toWalletId, amount: received },
  ];
  // postTransaction rejects zero postings.
  if (toFees !== 0n) postings.push({ walletId: w.feesWalletId, amount: toFees });
  return postings;
}
