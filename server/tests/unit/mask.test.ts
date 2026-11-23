import { describe, expect, it } from 'vitest';
import { maskNid } from '../../src/utils/mask';

describe('maskNid', () => {
  it('shows only the last 3 digits', () => {
    expect(maskNid('1234567890')).toBe('*******890');
  });
});
