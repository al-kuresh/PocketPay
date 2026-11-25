// Money is poisha in a string ("150050" = ৳1,500.50). Only BigInt and string maths here: never a float.
import type { Lang } from '../stores/language'
import { toAsciiDigits } from './digits'

// en-IN and bn-BD both group in lakhs (12,34,567); bn-BD also writes Bangla digits. Both format a BigInt exactly.
const whole = { en: new Intl.NumberFormat('en-IN'), bn: new Intl.NumberFormat('bn-BD') }
const twoDigits = {
  en: new Intl.NumberFormat('en-IN', { minimumIntegerDigits: 2 }),
  bn: new Intl.NumberFormat('bn-BD', { minimumIntegerDigits: 2 }),
}

/** "150050" → "৳1,500.50"; sign 'out' → "−৳500.00" (U+2212), 'in' → "+৳500.00"; lang 'bn' → "৳১,৫০০.৫০". */
export function formatTaka(poisha: string, opts: { sign?: 'in' | 'out'; lang?: Lang } = {}): string {
  if (!/^\d+$/.test(poisha)) throw new RangeError(`formatTaka: not a poisha string: "${poisha}"`)
  const lang = opts.lang ?? 'en'
  const p = BigInt(poisha)
  const sign = opts.sign === 'out' ? '−' : opts.sign === 'in' ? '+' : ''
  return `${sign}৳${whole[lang].format(p / 100n)}.${twoDigits[lang].format(p % 100n)}`
}

/**
 * What the user typed, in taka, → poisha. Accepts Bangla or ASCII digits, commas, surrounding spaces and at most
 * 2 decimals. Anything else (a sign, an exponent, 3 decimals, zero, empty) → null.
 */
export function takaToPoisha(input: string): string | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(toAsciiDigits(input).trim().replaceAll(',', ''))
  if (!m) return null
  const poisha = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'))
  return poisha > 0n ? poisha.toString() : null
}
