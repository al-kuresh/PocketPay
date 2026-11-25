import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { createActor } from './helpers/actors';
import { resetDb } from './helpers/db';

type Actor = Awaited<ReturnType<typeof createActor>>;
let app: ReturnType<typeof createApp>;
let rahim: Actor;
let agent: Actor;
let shop: Actor;
let admin: Actor;

beforeEach(async () => {
  await resetDb();
  app = createApp({ storage: new MemoryStorage() });
  rahim = await createActor({
    phone: '01711111111',
    nid: '1111111111',
    role: 'CUSTOMER',
    name: 'Rahim Uddin',
  });
  agent = await createActor({ phone: '01733333333', nid: '3333333333', role: 'AGENT' });
  shop = await createActor({
    phone: '01744444444',
    nid: '4444444444',
    role: 'MERCHANT',
    name: 'Selim Owner',
    shopName: 'Selim Store',
  });
  admin = await createActor({ phone: '01766666666', nid: '6666666666', role: 'ADMIN' });
});
afterAll(() => prisma.$disconnect());

const lookup = (phone: string, as: Actor | null = agent) => {
  const r = request(app).get('/api/v1/wallets/lookup').query({ phone });
  return as ? r.set('Authorization', `Bearer ${as.token}`) : r;
};

describe('GET /wallets/lookup', () => {
  it("a customer's phone → only { name: masked, role }: no phone, no hash, no NID", async () => {
    const res = await lookup(rahim.user.phone);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ name: 'Rahim U***', role: 'CUSTOMER' });
    const json = JSON.stringify(res.body);
    for (const secret of [rahim.user.phone, rahim.user.pinHash, rahim.user.nidNumber, 'Rahim Uddin']) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toContain('pinHash');
    expect(json).not.toContain('nidNumber');
  });

  it('a merchant → its shop name, never the owner', async () => {
    const res = await lookup(shop.user.phone, rahim);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ name: 'Selim Store', role: 'MERCHANT' });
    expect(JSON.stringify(res.body)).not.toContain('Selim Owner');
  });

  it('accepts Bangla digits in the phone', async () => {
    const res = await lookup('০১৭১১১১১১১১');
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('CUSTOMER');
  });

  it('an unknown or an admin phone → 404 RECEIVER_NOT_FOUND', async () => {
    for (const phone of ['01799999999', admin.user.phone]) {
      const res = await lookup(phone);
      expect(res.status, phone).toBe(404);
      expect(res.body.error.code).toBe('RECEIVER_NOT_FOUND');
    }
  });

  it('a bad or missing phone → 400 VALIDATION_ERROR', async () => {
    const bad = await lookup('12345');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const missing = await request(app)
      .get('/api/v1/wallets/lookup')
      .set('Authorization', `Bearer ${agent.token}`);
    expect(missing.status).toBe(400);
  });

  it('rate-limits per USER, not per IP: the 31st lookup is 429, another user still passes', async () => {
    // Limiters skip when NODE_ENV is 'test'; switch that off for this test only.
    const nodeEnv = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      // All requests come from the same IP (supertest, 127.0.0.1).
      for (let i = 1; i <= 30; i++) {
        expect((await lookup(rahim.user.phone, agent)).status, `lookup ${i}`).toBe(200);
      }
      const blocked = await lookup(rahim.user.phone, agent);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');

      const other = await lookup(shop.user.phone, rahim);
      expect(other.status).toBe(200);
    } finally {
      env.NODE_ENV = nodeEnv;
    }
  });

  it('a PENDING_KYC or REJECTED caller → 403 ACCOUNT_NOT_ACTIVE { status }', async () => {
    const pending = await createActor({
      phone: '01777777777',
      nid: '7777777777',
      role: 'CUSTOMER',
      status: 'PENDING_KYC',
    });
    const rejected = await createActor({
      phone: '01788888888',
      nid: '8888888888',
      role: 'CUSTOMER',
      status: 'REJECTED',
    });

    for (const [caller, status] of [
      [pending, 'PENDING_KYC'],
      [rejected, 'REJECTED'],
    ] as const) {
      const res = await lookup(rahim.user.phone, caller);
      expect(res.status, status).toBe(403);
      expect(res.body.error).toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE', details: { status } });
      expect(JSON.stringify(res.body)).not.toContain('Rahim');
    }
  });

  it('no token → 401; a MERCHANT or ADMIN → 403 FORBIDDEN', async () => {
    expect((await lookup(rahim.user.phone, null)).status).toBe(401);
    for (const as of [shop, admin]) {
      const res = await lookup(rahim.user.phone, as);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});
