import { describe, expect, it } from 'vitest';
import type { Posting } from '../../src/modules/ledger/ledger.types';
import { FLOWS } from '../../src/modules/transactions/flows';
import { buildPostings } from '../../src/modules/transactions/postings';

const w = { fromWalletId: 'from', toWalletId: 'to', feesWalletId: 'fees' };
const sum = (ps: Posting[]) => ps.reduce((s, p) => s + p.amount, 0n);

describe('buildPostings', () => {
  it('Send Money ৳500 with a ৳5 fee (design §8.3)', () => {
    const ps = buildPostings('SEND_MONEY', w, { amount: 50_000n, fee: 500n, commission: 0n });
    expect(ps).toEqual([
      { walletId: 'from', amount: -50_500n },
      { walletId: 'to', amount: 50_000n },
      { walletId: 'fees', amount: 500n },
    ]);
    expect(sum(ps)).toBe(0n);
  });

  it('Cash Out ৳1,000: the agent gets the amount plus commission, fees keep the rest', () => {
    const ps = buildPostings('CASH_OUT', w, { amount: 100_000n, fee: 1_850n, commission: 400n });
    expect(ps).toEqual([
      { walletId: 'from', amount: -101_850n },
      { walletId: 'to', amount: 100_400n },
      { walletId: 'fees', amount: 1_450n },
    ]);
    expect(sum(ps)).toBe(0n);
  });

  it('a zero fee gives 2 postings (no fees posting)', () => {
    const ps = buildPostings('SEND_MONEY', w, { amount: 5_000n, fee: 0n, commission: 0n });
    expect(ps).toEqual([
      { walletId: 'from', amount: -5_000n },
      { walletId: 'to', amount: 5_000n },
    ]);
    expect(sum(ps)).toBe(0n);
  });

  it('Cash In with the default zero fee gives 2 postings', () => {
    const ps = buildPostings('CASH_IN', w, { amount: 100_000n, fee: 0n, commission: 0n });
    expect(ps).toEqual([
      { walletId: 'from', amount: -100_000n },
      { walletId: 'to', amount: 100_000n },
    ]);
  });

  it('Cash Out with fee = commission gives 2 postings', () => {
    const ps = buildPostings('CASH_OUT', w, { amount: 100_000n, fee: 400n, commission: 400n });
    expect(ps).toEqual([
      { walletId: 'from', amount: -100_400n },
      { walletId: 'to', amount: 100_400n },
    ]);
    expect(sum(ps)).toBe(0n);
  });

  it('Payment ৳250 with a ৳2 merchant fee: the merchant pays the fee', () => {
    const ps = buildPostings('PAYMENT', w, { amount: 25_000n, fee: 200n, commission: 0n });
    expect(ps).toEqual([
      { walletId: 'from', amount: -25_000n },
      { walletId: 'to', amount: 24_800n },
      { walletId: 'fees', amount: 200n },
    ]);
    expect(sum(ps)).toBe(0n);
  });

  it('throws on a commission outside Cash Out, instead of crediting it silently', () => {
    expect(() =>
      buildPostings('SEND_MONEY', w, { amount: 50_000n, fee: 500n, commission: 100n }),
    ).toThrow(/commission/);
  });
});

describe('FLOWS', () => {
  // A change to who may pay whom must show up here as a diff.
  it('matches the flow table', () => {
    expect(FLOWS).toMatchInlineSnapshot(`
      {
        "CASH_IN": {
          "feePaidBy": "sender",
          "initiator": "AGENT",
          "limitSide": "to",
          "receiver": "CUSTOMER",
        },
        "CASH_OUT": {
          "feePaidBy": "sender",
          "initiator": "CUSTOMER",
          "limitSide": "from",
          "receiver": "AGENT",
        },
        "PAYMENT": {
          "feePaidBy": "receiver",
          "initiator": "CUSTOMER",
          "limitSide": "from",
          "receiver": "MERCHANT",
        },
        "SEND_MONEY": {
          "feePaidBy": "sender",
          "initiator": "CUSTOMER",
          "limitSide": "from",
          "receiver": "CUSTOMER",
        },
      }
    `);
  });
});
