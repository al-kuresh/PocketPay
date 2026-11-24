import type { Wallet } from '../../generated/prisma/client';

/** The only shape of a wallet that leaves the server. `balance` is poisha as a string (§8.1). */
export interface PublicWallet {
  id: string;
  type: Wallet['type'];
  balance: string;
}

// res.json throws on a raw bigint, so the balance must be converted here.
export function toPublicWallet(w: Wallet): PublicWallet {
  return { id: w.id, type: w.type, balance: w.balance.toString() };
}
