const BANGLA_ZERO = 0x09e6 // '০'; the ten Bangla digits are consecutive code points

/** "০১৭" → "017". Everything that isn't a Bangla digit is left as it is. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String.fromCharCode(48 + d.charCodeAt(0) - BANGLA_ZERO))
}
