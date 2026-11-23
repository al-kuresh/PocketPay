import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { OtpProvider } from '../src/lib/otp';
import { prisma } from '../src/lib/prisma';
import { verifyRegistrationToken } from '../src/modules/auth/tokens';
import { resetDb } from './helpers/db';

const PHONE = '01712345678';

/** Records every OTP "sent", instead of logging it. */
class FakeOtpProvider implements OtpProvider {
  sent: { phone: string; code: string }[] = [];
  async send(phone: string, code: string) {
    this.sent.push({ phone, code });
  }
}

let otpProvider: FakeOtpProvider;
let app: ReturnType<typeof createApp>;

const requestOtp = (phone = PHONE) =>
  request(app).post('/api/v1/auth/register/request-otp').send({ phone });
const verifyOtp = (code: string, phone = PHONE) =>
  request(app).post('/api/v1/auth/register/verify-otp').send({ phone, code });

/** A valid 6-digit code that is guaranteed not to be `code`. */
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

beforeEach(async () => {
  await resetDb();
  otpProvider = new FakeOtpProvider();
  app = createApp({ otpProvider });
});
afterAll(() => prisma.$disconnect());

describe('POST /auth/register/request-otp', () => {
  it('creates a hashed OTP, sends it and echoes it in dev', async () => {
    const res = await requestOtp();

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ expiresInSeconds: 300, resendInSeconds: 60 });
    const devOtp = res.body.data.devOtp;
    expect(devOtp).toMatch(/^\d{6}$/);

    expect(otpProvider.sent).toEqual([{ phone: PHONE, code: devOtp }]);

    const rows = await prisma.otpCode.findMany({ where: { phone: PHONE } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).not.toBe(devOtp);
    expect(rows[0]?.codeHash).not.toContain(devOtp);
  });

  it('rejects a phone that already has an account', async () => {
    await prisma.user.create({
      data: {
        phone: PHONE,
        nidNumber: '1234567890',
        name: 'Existing User',
        dateOfBirth: new Date('1995-06-15'),
        pinHash: 'x',
        role: 'CUSTOMER',
      },
    });

    const res = await requestOtp();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_TAKEN');
    expect(otpProvider.sent).toHaveLength(0);
  });

  it('enforces a 60-second resend cooldown', async () => {
    expect((await requestOtp()).status).toBe(200);

    const second = await requestOtp();
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('OTP_COOLDOWN');
    expect(second.body.error.details.retryAfterSeconds).toBeGreaterThan(0);

    // Pretend the first OTP was sent 61 seconds ago.
    await prisma.otpCode.updateMany({
      where: { phone: PHONE },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    expect((await requestOtp()).status).toBe(200);
  });

  it('returns 502 and leaves no OTP behind when sending fails, so a retry works at once', async () => {
    const failing: OtpProvider = {
      send: async () => {
        throw new Error('SMS gateway down');
      },
    };

    const res = await request(createApp({ otpProvider: failing }))
      .post('/api/v1/auth/register/request-otp')
      .send({ phone: PHONE });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('OTP_SEND_FAILED');
    expect(await prisma.otpCode.count({ where: { phone: PHONE } })).toBe(0);

    // No cooldown: the failed attempt left nothing to wait for.
    expect((await requestOtp()).status).toBe(200);
  });

  it('rejects an invalid phone with VALIDATION_ERROR', async () => {
    const res = await requestOtp('+8801712345678');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ path: 'phone' });
  });
});

describe('POST /auth/register/verify-otp', () => {
  it('returns a registration token for the right code', async () => {
    const { devOtp } = (await requestOtp()).body.data;

    const res = await verifyOtp(devOtp);

    expect(res.status).toBe(200);
    expect(res.body.data.expiresInSeconds).toBe(900);
    expect(verifyRegistrationToken(res.body.data.registrationToken).phone).toBe(PHONE);

    const row = await prisma.otpCode.findFirstOrThrow({ where: { phone: PHONE } });
    expect(row.verifiedAt).not.toBeNull();
  });

  it('counts wrong codes and locks after 5', async () => {
    const { devOtp } = (await requestOtp()).body.data;
    const bad = wrongCode(devOtp);

    const first = await verifyOtp(bad);
    expect(first.status).toBe(400);
    expect(first.body.error.code).toBe('OTP_INVALID');
    expect(first.body.error.details).toEqual({ attemptsLeft: 4 });

    for (let i = 0; i < 3; i++) expect((await verifyOtp(bad)).status).toBe(400);

    const fifth = await verifyOtp(bad);
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe('OTP_LOCKED');

    const right = await verifyOtp(devOtp);
    expect(right.status).toBe(429);
    expect(right.body.error.code).toBe('OTP_LOCKED');
  });

  it('never allows more than 5 guesses, even in parallel', async () => {
    const { devOtp } = (await requestOtp()).body.data;
    const bad = wrongCode(devOtp);

    const results = await Promise.all(Array.from({ length: 10 }, () => verifyOtp(bad)));

    const invalid = results.filter((r) => r.body.error?.code === 'OTP_INVALID');
    expect(invalid.length).toBeLessThanOrEqual(4);
    const row = await prisma.otpCode.findFirstOrThrow({ where: { phone: PHONE } });
    expect(row.attempts).toBe(5);
  });

  it('rejects an expired code', async () => {
    const { devOtp } = (await requestOtp()).body.data;
    await prisma.otpCode.updateMany({
      where: { phone: PHONE },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await verifyOtp(devOtp);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('rejects verify when no OTP was requested', async () => {
    const res = await verifyOtp('123456');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });
});
