/** `1234567890` → `*******890`. Use this anywhere an NID leaves the server (except admin KYC review). */
export function maskNid(nid: string): string {
  return '*******' + nid.slice(-3);
}

/** `01712345678` → `017******78`, so logs never hold a full phone number. */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}******${phone.slice(-2)}`;
}
