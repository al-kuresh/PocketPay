import { describe, expect, it } from 'vitest';
import { maskNid, maskPhone } from '../../src/utils/mask';

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
