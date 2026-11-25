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

/**
 * The amount as the keypad or a keyboard leaves it: `next` is what the user tried to make of `text`. Kept as ASCII
 * digits with at most 7 before the point (৳99,99,999 is past every limit and still fits the 64px amount) and 2 after.
 * Anything else (a 3rd decimal, a 2nd point, a letter, a sign) keeps the old `text`. Only takaToPoisha reads the result.
 */
export function editAmount(text: string, next: string): string {
  const clean = toAsciiDigits(next).replaceAll(',', '').replace(/^\./, '0.').replace(/^0+(?=\d)/, '')
  return /^\d{0,7}(\.\d{0,2})?$/.test(clean) ? clean : text
}
