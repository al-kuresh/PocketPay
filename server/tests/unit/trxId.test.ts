import { describe, expect, it } from 'vitest';
import { generateTrxId } from '../../src/utils/trxId';

describe('generateTrxId', () => {
  it('is PP + 8 receipt-friendly characters (no 0/O, 1/I/L)', () => {
    expect(generateTrxId()).toMatch(/^PP[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('gives 10,000 unique ids', () => {
    const ids = new Set(Array.from({ length: 10_000 }, generateTrxId));
    expect(ids.size).toBe(10_000);
  });
});
