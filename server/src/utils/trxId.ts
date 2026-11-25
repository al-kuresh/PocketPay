import { randomInt } from 'node:crypto';

// No 0/O or 1/I/L, so an id reads unambiguously off a receipt.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** What a generated trxId looks like. */
export const TRX_ID_PATTERN = new RegExp(`^PP[${ALPHABET}]{8}$`);

/** `PP` + 8 random characters, e.g. `PP7KQ3MZ2A`. Uniqueness is enforced by `transactions_trx_id_key`. */
export function generateTrxId(): string {
  let id = 'PP';
  for (let i = 0; i < 8; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}
