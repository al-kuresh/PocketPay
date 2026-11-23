import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { resetDb } from './helpers/db';

const baseUser = {
  phone: '01712345678',
  nidNumber: '1234567890',
  name: 'Test User',
  dateOfBirth: new Date('1995-06-15'),
  pinHash: 'not-a-real-hash',
  role: 'CUSTOMER' as const,
};

describe('database', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('creates and reads a user', async () => {
    await prisma.user.create({ data: baseUser });

    const user = await prisma.user.findUnique({ where: { phone: baseUser.phone } });
    expect(user).not.toBeNull();
    expect(user?.nidNumber).toBe(baseUser.nidNumber);
    expect(user?.status).toBe('PENDING_KYC');
    expect(user?.failedPinAttempts).toBe(0);
  });

  it('rejects a duplicate NID with P2002 on users_nid_number_key', async () => {
    await prisma.user.create({ data: baseUser });

    const error = await prisma.user.create({ data: { ...baseUser, phone: '01812345678' } }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toMatchObject({
      code: 'P2002',
      meta: { driverAdapterError: { cause: { constraint: { index: 'users_nid_number_key' } } } },
    });
  });
});
