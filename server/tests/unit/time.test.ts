import { describe, expect, it } from 'vitest';
import { dhakaDateRange, dhakaDayStart, dhakaMonthStart } from '../../src/utils/time';

describe('dhakaDayStart', () => {
  it('17:59:59Z is still the same Dhaka day', () => {
    expect(dhakaDayStart(new Date('2026-11-24T17:59:59Z')).toISOString()).toBe(
      '2026-11-23T18:00:00.000Z',
    );
  });

  it('18:00:00Z is already the next Dhaka day', () => {
    expect(dhakaDayStart(new Date('2026-11-24T18:00:00Z')).toISOString()).toBe(
      '2026-11-24T18:00:00.000Z',
    );
  });
});

describe('dhakaMonthStart', () => {
  it('uses the Dhaka month, which can be ahead of the UTC month', () => {
    // 2026-11-30T18:30Z is 00:30 on 1 December in Dhaka.
    expect(dhakaMonthStart(new Date('2026-11-30T18:30:00Z')).toISOString()).toBe(
      '2026-11-30T18:00:00.000Z',
    );
  });

  it('a mid-month instant gives 00:00 Dhaka on the 1st', () => {
    expect(dhakaMonthStart(new Date('2026-11-24T10:00:00Z')).toISOString()).toBe(
      '2026-10-31T18:00:00.000Z',
    );
  });
});

describe('dhakaDateRange', () => {
  it('covers both days in full: gte the start of from, lt the start of the day after to', () => {
    expect(dhakaDateRange('2026-11-01', '2026-11-24')).toEqual({
      gte: new Date('2026-10-31T18:00:00.000Z'),
      lt: new Date('2026-11-24T18:00:00.000Z'),
    });
  });

  it('either side may be absent', () => {
    expect(dhakaDateRange('2026-11-01')).toEqual({ gte: new Date('2026-10-31T18:00:00.000Z') });
    expect(dhakaDateRange(undefined, '2026-11-24')).toEqual({
      lt: new Date('2026-11-24T18:00:00.000Z'),
    });
    expect(dhakaDateRange()).toEqual({});
  });

  it('throws on a date that is not a real calendar date', () => {
    expect(() => dhakaDateRange('2026-02-30')).toThrow();
    expect(() => dhakaDateRange(undefined, '2026-02-30')).toThrow();
    expect(() => dhakaDateRange('2026-1-5')).toThrow();
  });
});
