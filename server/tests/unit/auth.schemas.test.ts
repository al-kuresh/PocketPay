import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeRegistrationBody,
  dobSchema,
  loginBody,
  nidSchema,
  phoneSchema,
  pinSchema,
  verifyOtpBody,
} from '../../src/modules/auth/auth.schemas';
import { dhakaToday } from '../../src/utils/time';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe('phoneSchema', () => {
  it('accepts a BD mobile number', () => {
    expect(ok(phoneSchema, '01712345678')).toBe(true);
  });

  it('rejects +880 form with a message showing the expected format', () => {
    const r = phoneSchema.safeParse('+8801712345678');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain('01XXXXXXXXX');
  });

  it.each(['0171234567', '01212345678', '017 1234 5678'])('rejects %s', (phone) => {
    expect(ok(phoneSchema, phone)).toBe(false);
  });
});

describe('nidSchema', () => {
  it('accepts 10 digits', () => {
    expect(ok(nidSchema, '1234567890')).toBe(true);
  });

  it.each(['123456789', '12345678901', '12345abcde', '19901234567890123'])('rejects %s', (nid) => {
    expect(ok(nidSchema, nid)).toBe(false);
  });
});

describe('pinSchema', () => {
  it('accepts a non-trivial 5-digit PIN', () => {
    expect(ok(pinSchema, '48213')).toBe(true);
  });

  it.each(['11111', '12345', '54321', '01234', '98765', '1234', '123456', '12a45'])(
    'rejects %s',
    (pin) => {
      expect(ok(pinSchema, pin)).toBe(false);
    },
  );
});

describe('dobSchema (today = 2026-11-24 in Dhaka)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-11-24 00:30 in Dhaka is still 2026-11-23 in UTC: proves we use Dhaka's date.
    vi.setSystemTime(new Date('2026-11-23T18:30:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('uses Dhaka time for today', () => {
    expect(dhakaToday()).toBe('2026-11-24');
  });

  it('accepts someone turning 18 today', () => {
    expect(ok(dobSchema, '2008-11-24')).toBe(true);
  });

  it.each(['2008-11-25', '2030-01-01', '1899-12-31'])('rejects %s', (dob) => {
    expect(ok(dobSchema, dob)).toBe(false);
  });
});

describe('leap-day birthday (DOB 2008-02-29)', () => {
  afterEach(() => vi.useRealTimers());

  // Rule: a 29 Feb birthday turns 18 on 1 Mar in non-leap years, because the cutoff
  // string 2008-02-28 sorts before 2008-02-29.
  it('is not 18 yet on 2026-02-28 in Dhaka', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T06:00:00Z'));
    expect(ok(dobSchema, '2008-02-29')).toBe(false);
  });

  it('is 18 on 2026-03-01 in Dhaka', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T06:00:00Z'));
    expect(ok(dobSchema, '2008-02-29')).toBe(true);
  });
});

describe('Bangla digits are accepted', () => {
  it('converts a Bangla phone number', () => {
    expect(phoneSchema.parse('০১৭১২৩৪৫৬৭৮')).toBe('01712345678');
  });

  it('converts a mixed Bangla/ASCII phone number', () => {
    expect(phoneSchema.parse('01৭12345678')).toBe('01712345678');
  });

  it('converts a Bangla NID', () => {
    expect(nidSchema.parse('১২৩৪৫৬৭৮৯০')).toBe('1234567890');
  });

  it('accepts a Bangla PIN and still applies the weak-PIN rules', () => {
    expect(pinSchema.parse('৪৮২১৩')).toBe('48213');
    expect(ok(pinSchema, '১২৩৪৫')).toBe(false);
  });

  it('converts the OTP code and the login PIN', () => {
    expect(verifyOtpBody.parse({ phone: '01712345678', code: '১২৩৪৫৬' }).code).toBe('123456');
    expect(loginBody.parse({ phone: '01712345678', pin: '১১১১১' }).pin).toBe('11111');
  });
});

describe('completeRegistrationBody', () => {
  const valid = {
    name: 'Rahim Uddin',
    dateOfBirth: '1995-06-15',
    nidNumber: '1234567890',
    role: 'CUSTOMER',
    pin: '48213',
    confirmPin: '48213',
  };

  it('accepts a valid customer', () => {
    expect(ok(completeRegistrationBody, valid)).toBe(true);
  });

  it('rejects a MERCHANT without shopName', () => {
    expect(ok(completeRegistrationBody, { ...valid, role: 'MERCHANT' })).toBe(false);
  });

  it('accepts a MERCHANT with shopName', () => {
    expect(
      ok(completeRegistrationBody, { ...valid, role: 'MERCHANT', shopName: 'Rahim Store' }),
    ).toBe(true);
  });

  it('rejects ADMIN', () => {
    expect(ok(completeRegistrationBody, { ...valid, role: 'ADMIN' })).toBe(false);
  });

  it('rejects a confirmPin mismatch on the confirmPin path', () => {
    const r = completeRegistrationBody.safeParse({ ...valid, confirmPin: '48214' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('confirmPin');
  });

  it('reports a weak PIN and a confirmPin mismatch together', () => {
    const r = completeRegistrationBody.safeParse({ ...valid, pin: '11111', confirmPin: '22222' });
    const paths = r.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('pin');
    expect(paths).toContain('confirmPin');
  });

  it('matches a Bangla confirmPin against an ASCII pin', () => {
    expect(ok(completeRegistrationBody, { ...valid, confirmPin: '৪৮২১৩' })).toBe(true);
  });

  it('drops shopName for non-merchants', () => {
    const parsed = completeRegistrationBody.parse({ ...valid, shopName: 'Not A Shop' });
    expect(parsed).not.toHaveProperty('shopName');
  });

  it('keeps shopName for merchants', () => {
    const parsed = completeRegistrationBody.parse({ ...valid, role: 'MERCHANT', shopName: 'Rahim Store' });
    expect(parsed).toHaveProperty('shopName', 'Rahim Store');
  });
});
