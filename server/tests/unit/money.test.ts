import { describe, expect, it } from 'vitest';
import { percentOfBp, poishaSchema, poishaToString, taka } from '../../src/utils/money';

describe('percentOfBp', () => {
  it('computes the cash-out fee and agent commission from design §8.3', () => {
    expect(percentOfBp(100_000n, 185)).toBe(1_850n); // ৳1,000 × 1.85% = ৳18.50
    expect(percentOfBp(100_000n, 40)).toBe(400n); // ৳1,000 × 0.40% = ৳4
  });

  it('rounds half up to the nearest poisha', () => {
    expect(percentOfBp(2n, 2500)).toBe(1n); // 0.5 → 1
    expect(percentOfBp(6n, 2500)).toBe(2n); // 1.5 → 2
    expect(percentOfBp(1n, 2499)).toBe(0n); // 0.2499 → 0
  });

  it('is 0 for 0 bp', () => {
    expect(percentOfBp(123_456n, 0)).toBe(0n);
  });

  it.each([-1, 10_001, 1.5])('throws for bp %s', (bp) => {
    expect(() => percentOfBp(100n, bp)).toThrow();
  });

  it('throws for a negative amount', () => {
    expect(() => percentOfBp(-1n, 185)).toThrow();
  });
});

describe('taka', () => {
  it('turns whole taka into poisha', () => {
    expect(taka(500)).toBe(50_000n);
  });

  it('throws for a non-integer', () => {
    expect(() => taka(1.5)).toThrow();
  });
});

describe('poishaToString', () => {
  it('is the plain poisha string used in JSON', () => {
    expect(poishaToString(150_050n)).toBe('150050');
  });
});

describe('poishaSchema', () => {
  const MESSAGE = 'Amount must be a whole number of poisha, e.g. "150050" for ৳1,500.50';

  it('parses a poisha string into a bigint', () => {
    expect(poishaSchema.parse('150050')).toBe(150_050n);
  });

  it.each(['0', '-5', '15.50', '1e5', '', '1234567890123456', 150050])('rejects %j', (input) => {
    const result = poishaSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(MESSAGE);
  });
});
