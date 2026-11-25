import { describe, expect, it } from 'vitest';
import { maskName, maskNid, maskPhone } from '../../src/utils/mask';

describe('maskName', () => {
  it('keeps the first word and shortens the rest to an initial', () => {
    expect(maskName('Rahim Uddin')).toBe('Rahim U***');
  });

  it('trims and collapses whitespace first', () => {
    expect(maskName('  Md   Karim Hasan ')).toBe('Md K*** H***');
  });

  it('a single-word name keeps its first 2 letters', () => {
    expect(maskName('Rahim')).toBe('Ra***');
  });
});

describe('maskNid', () => {
  it('shows only the last 3 digits', () => {
    expect(maskNid('1234567890')).toBe('*******890');
  });
});

describe('maskPhone', () => {
  it('shows the operator prefix and the last 2 digits', () => {
    expect(maskPhone('01712345678')).toBe('017******78');
  });
});
