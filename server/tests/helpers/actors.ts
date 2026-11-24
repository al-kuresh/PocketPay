import type { Prisma } from '../../src/generated/prisma/client';
import type { Role, TransactionType, UserStatus } from '../../src/generated/prisma/enums';
import { prisma } from '../../src/lib/prisma';
import { hashPin } from '../../src/modules/auth/pin';
import { signAccessToken } from '../../src/modules/auth/tokens';

/** A user (ACTIVE by default) with a real PIN hash, its wallet (admins get none) and an access token. */
export async function createActor(opts: {
  phone: string;
  nid: string;
  role: Role;
  status?: UserStatus;
  pin?: string;
  name?: string;
  shopName?: string;
}) {
  const { phone, nid, role, status = 'ACTIVE', pin = '48213', name = 'Test User' } = opts;
  const user = await prisma.user.create({
    data: {
      phone,
      nidNumber: nid,
      name,
      shopName: opts.shopName,
      dateOfBirth: new Date('1995-06-15'),
      pinHash: await hashPin(pin),
      role,
      status,
    },
  });
  const wallet =
    role === 'ADMIN' ? null : await prisma.wallet.create({ data: { userId: user.id, type: role } });
  return { user, wallet, token: signAccessToken({ userId: user.id, role }) };
}

/** Tighten (or loosen) a seeded limit rule, e.g. `setLimit('SEND_MONEY', { maxCountDay: 2 })`. */
export const setLimit = (type: TransactionType, patch: Prisma.LimitRuleUpdateInput) =>
  prisma.limitRule.update({ where: { type }, data: patch });

/** Set a system_settings value, e.g. `setSetting('CUSTOMER_MAX_BALANCE', '100000')`. */
export const setSetting = (key: string, value: string) =>
  prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
