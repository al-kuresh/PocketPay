/** `1234567890` → `*******890`. Use this anywhere an NID leaves the server (except admin KYC review). */
export function maskNid(nid: string): string {
  return '*******' + nid.slice(-3);
}
