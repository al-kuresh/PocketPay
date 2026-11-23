/** Bangla digits ০–৯ (U+09E6–U+09EF) → ASCII 0–9. Bangla keyboards on phones type these. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
}
