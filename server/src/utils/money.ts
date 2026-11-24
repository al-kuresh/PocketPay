import { z } from 'zod';

// Money is bigint poisha everywhere (৳1 = 100n). Never number, never floats (design §8.1).

/** Whole taka → poisha: `taka(500) === 50_000n`. For seeds and tests. */
export function taka(whole: number): bigint {
  if (!Number.isInteger(whole) || Math.abs(whole) > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error(`taka() needs a safe whole number of taka, got ${whole}`);
  }
  return BigInt(whole) * 100n;
}

/** `amount × bp / 10_000`, rounded half-up to the nearest poisha, in integer maths only. */
export function percentOfBp(amount: bigint, bp: number): bigint {
  if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) {
    throw new Error(`bp must be an integer from 0 to 10000, got ${bp}`);
  }
  if (amount < 0n) {
    throw new Error(`amount must not be negative, got ${amount}`);
  }
  return (amount * BigInt(bp) * 2n + 10_000n) / 20_000n;
}

/** How money goes into JSON: `res.json` throws on a raw bigint. */
export function poishaToString(p: bigint): string {
  return p.toString();
}

/** Poisha → "৳1,00,000.00" (Bangladeshi digit grouping). For scripts and logs, not the API. */
export function formatTaka(poisha: bigint | string): string {
  const p = BigInt(poisha);
  const abs = p < 0n ? -p : p;
  const whole = new Intl.NumberFormat('en-IN').format(abs / 100n);
  return `${p < 0n ? '-' : ''}৳${whole}.${(abs % 100n).toString().padStart(2, '0')}`;
}

const POISHA_MESSAGE = 'Amount must be a whole number of poisha, e.g. "150050" for ৳1,500.50';

/** A request-body amount: a string of 1–15 digits, parsed to a bigint > 0. */
export const poishaSchema = z
  .string({ error: POISHA_MESSAGE })
  .regex(/^\d{1,15}$/, POISHA_MESSAGE)
  .transform((s) => BigInt(s))
  .refine((p) => p > 0n, POISHA_MESSAGE);
