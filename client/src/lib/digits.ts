const BANGLA_ZERO = 0x09e6 // '০'; the ten Bangla digits are consecutive code points

/** "০১৭" → "017". Everything that isn't a Bangla digit is left as it is. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String.fromCharCode(48 + d.charCodeAt(0) - BANGLA_ZERO))
}

/** "1500.50" → "১৫০০.৫০" in bn; en leaves it. Only for showing text the user typed (amounts go through formatTaka). */
export function toLangDigits(s: string, lang: 'en' | 'bn'): string {
  return lang === 'bn' ? s.replace(/[0-9]/g, (d) => String.fromCharCode(BANGLA_ZERO + d.charCodeAt(0) - 48)) : s
}
