/** `1234567890` → `*******890`. Use this anywhere an NID leaves the server (except admin KYC review). */
export function maskNid(nid: string): string {
  return '*******' + nid.slice(-3);
}

/** `01712345678` → `017******78`, so logs never hold a full phone number. */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}******${phone.slice(-2)}`;
}

/** "Rahim Uddin" → "Rahim U***", "Rahim" → "Ra***". Use this anywhere a person's name leaves the server. */
export function maskName(name: string): string {
  // Array.from splits by code point, so a letter outside the BMP is never cut in half.
  const [first = [], ...rest] = name
    .trim()
    .split(/\s+/)
    .map((w) => Array.from(w));
  if (rest.length === 0) return `${first.slice(0, 2).join('')}***`;
  return [first.join(''), ...rest.map((w) => `${w[0]}***`)].join(' ');
}
