import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env';

// The minimum set of required keys; each test adds or breaks one thing.
const base = {
  DATABASE_URL: 'postgresql://a:b@localhost:5433/c',
  JWT_SECRET: 'x'.repeat(32),
  FILE_URL_SECRET: 'y'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const e = parseEnv(base);
    expect(e.PORT).toBe(4000);
    expect(e.NODE_ENV).toBe('development');
    expect(e.CLIENT_ORIGIN).toBe('http://localhost:5173');
    expect(e.OTP_DEV_ECHO).toBe(true);
    expect(e.KYC_AUTO_APPROVE).toBe(false);
    expect(e.STORAGE_DRIVER).toBe('local');
  });

  it('names the missing key', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => parseEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('parses boolean flags from strings', () => {
    const e = parseEnv({ ...base, OTP_DEV_ECHO: 'false', KYC_AUTO_APPROVE: 'true' });
    expect(e.OTP_DEV_ECHO).toBe(false);
    expect(e.KYC_AUTO_APPROVE).toBe(true);
  });

  it('requires CLOUDINARY_URL when STORAGE_DRIVER=cloudinary', () => {
    expect(() => parseEnv({ ...base, STORAGE_DRIVER: 'cloudinary' })).toThrow(/CLOUDINARY_URL/);
  });

  it('rejects a CLOUDINARY_URL that is not a cloudinary:// URL', () => {
    expect(() => parseEnv({ ...base, CLOUDINARY_URL: 'https://x' })).toThrow(/CLOUDINARY_URL/);
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'x'.repeat(31) })).toThrow(/JWT_SECRET/);
  });

  it('requires a FILE_URL_SECRET of at least 32 characters when STORAGE_DRIVER=local', () => {
    expect(() => parseEnv({ ...base, FILE_URL_SECRET: undefined })).toThrow(/FILE_URL_SECRET/);
    expect(() => parseEnv({ ...base, FILE_URL_SECRET: 'y'.repeat(31) })).toThrow(/FILE_URL_SECRET/);
    expect(parseEnv(base).FILE_URL_SECRET).toBe('y'.repeat(32));
  });

  it('does not need FILE_URL_SECRET with Cloudinary', () => {
    const e = parseEnv({
      ...base,
      FILE_URL_SECRET: undefined,
      STORAGE_DRIVER: 'cloudinary',
      CLOUDINARY_URL: 'cloudinary://k:s@c',
    });
    expect(e.FILE_URL_SECRET).toBeUndefined();
  });
});
