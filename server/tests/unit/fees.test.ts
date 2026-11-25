import { describe, expect, it } from 'vitest';
import { calculateFee } from '../../src/modules/transactions/fees';

const free = { flatFee: 0n, percentBp: 0, agentCommissionBp: 0, minAmountForFee: 0n };
// The seed rules (src/db/seed.ts, design §6.3).
const SEND_MONEY = { ...free, flatFee: 500n, minAmountForFee: 10_000n };
const CASH_OUT = { ...free, percentBp: 185, agentCommissionBp: 40 };

describe('calculateFee', () => {
  it('Send Money: exactly ৳100.00 is free, ৳100.01 pays ৳5', () => {
    expect(calculateFee(SEND_MONEY, 10_000n)).toEqual({ fee: 0n, commission: 0n });
    expect(calculateFee(SEND_MONEY, 10_001n)).toEqual({ fee: 500n, commission: 0n });
  });

  it('Cash Out ৳1,000: 1.85% fee, 0.40% commission', () => {
    expect(calculateFee(CASH_OUT, 100_000n)).toEqual({ fee: 1_850n, commission: 400n });
  });

  it('rounds half-up to the poisha', () => {
    // 616.66… → 617 and 133.33… → 133
    expect(calculateFee(CASH_OUT, 33_333n)).toEqual({ fee: 617n, commission: 133n });
  });

  it('no fee means no commission: the commission comes out of the fee (design §15 #13)', () => {
    const rule = { ...CASH_OUT, minAmountForFee: 10_000n };
    expect(calculateFee(rule, 10_000n)).toEqual({ fee: 0n, commission: 0n });
    expect(calculateFee(rule, 10_001n)).toEqual({ fee: 185n, commission: 40n });
  });

  it('no rule means no fee', () => {
    expect(calculateFee(null, 100_000n)).toEqual({ fee: 0n, commission: 0n });
  });

  it('throws when the commission is greater than the fee (a bad rule)', () => {
    expect(() => calculateFee({ ...free, percentBp: 10, agentCommissionBp: 40 }, 100_000n)).toThrow(
      /commission/,
    );
  });
});
