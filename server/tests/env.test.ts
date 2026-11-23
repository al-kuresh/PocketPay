import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env';

describe('parseEnv', () => {
  it('applies defaults', () => {
    const e = parseEnv({ DATABASE_URL: 'postgresql://a:b@localhost:5433/c' });
    expect(e.PORT).toBe(4000);
    expect(e.NODE_ENV).toBe('development');
    expect(e.CLIENT_ORIGIN).toBe('http://localhost:5173');
  });

  it('names the missing key', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://a:b@h:1/c', PORT: 'abc' })).toThrow(/PORT/);
  });
});
