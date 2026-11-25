import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import type { FlowType } from '../src/modules/transactions/flows';
import { assertReceiver, findAccountByPhone, toParty } from '../src/modules/transactions/parties';
import { createActor } from './helpers/actors';
import { resetDb } from './helpers/db';

type Actor = Awaited<ReturnType<typeof createActor>>;
const actors = {} as Record<
  'rahim' | 'karim' | 'agent' | 'store' | 'admin' | 'pending' | 'frozenAgent',
  Actor
>;

// Nothing here writes to the database, so the accounts are created once.
beforeAll(async () => {
  await resetDb();
  actors.rahim = await createActor({
    phone: '01711111111',
    nid: '1111111111',
    role: 'CUSTOMER',
    name: 'Rahim Uddin',
  });
  actors.karim = await createActor({ phone: '01722222222', nid: '2222222222', role: 'CUSTOMER' });
  actors.agent = await createActor({
    phone: '01733333333',
    nid: '3333333333',
    role: 'AGENT',
    name: 'Abdul Karim',
  });
  actors.store = await createActor({
    phone: '01744444444',
    nid: '4444444444',
    role: 'MERCHANT',
    name: 'Salma Begum',
    shopName: 'Salma Store',
  });
  actors.admin = await createActor({ phone: '01755555555', nid: '5555555555', role: 'ADMIN' });
  actors.pending = await createActor({
    phone: '01766666666',
    nid: '6666666666',
    role: 'CUSTOMER',
    status: 'PENDING_KYC',
  });
  actors.frozenAgent = await createActor({
    phone: '01777777777',
    nid: '7777777777',
    role: 'AGENT',
    status: 'FROZEN',
  });
});
afterAll(() => prisma.$disconnect());

/** assertReceiver with the receiver looked up by phone, as the flows will do it. */
const receive = async (flow: FlowType, from: Actor, phone: string) =>
  assertReceiver(flow, from.user, await findAccountByPhone(prisma, phone));

describe('findAccountByPhone', () => {
  it('returns the user with its wallet, an admin with none, and null for an unknown phone', async () => {
    const rahim = await findAccountByPhone(prisma, actors.rahim.user.phone);
    expect(rahim).toMatchObject({
      id: actors.rahim.user.id,
      wallet: { id: actors.rahim.wallet!.id },
    });
    expect(await findAccountByPhone(prisma, actors.admin.user.phone)).toMatchObject({
      role: 'ADMIN',
      wallet: null,
    });
    expect(await findAccountByPhone(prisma, '01899999999')).toBeNull();
  });
});

describe('assertReceiver', () => {
  it('refuses an unknown phone with 404 RECEIVER_NOT_FOUND', async () => {
    await expect(receive('SEND_MONEY', actors.rahim, '01899999999')).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECEIVER_NOT_FOUND',
    });
  });

  it("answers an admin's phone exactly like an unknown one", async () => {
    await expect(
      receive('SEND_MONEY', actors.rahim, actors.admin.user.phone),
    ).rejects.toMatchObject({ statusCode: 404, code: 'RECEIVER_NOT_FOUND' });
  });

  it('refuses yourself with CANNOT_SEND_TO_SELF, before checking the role', async () => {
    // A CASH_OUT needs an agent, so the role is wrong too: "yourself" is reported first.
    await expect(receive('CASH_OUT', actors.rahim, actors.rahim.user.phone)).rejects.toMatchObject({
      statusCode: 422,
      code: 'CANNOT_SEND_TO_SELF',
    });
  });

  it("refuses a receiver whose role doesn't fit the flow, before checking its status", async () => {
    // Frozen too: the role is reported first.
    await expect(
      receive('SEND_MONEY', actors.rahim, actors.frozenAgent.user.phone),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_RECEIVER',
      details: { expectedRole: 'CUSTOMER' },
    });
    await expect(receive('PAYMENT', actors.rahim, actors.karim.user.phone)).rejects.toMatchObject({
      code: 'INVALID_RECEIVER',
      details: { expectedRole: 'MERCHANT' },
    });
  });

  it('refuses a receiver that is not ACTIVE with RECEIVER_NOT_ACTIVE', async () => {
    await expect(
      receive('SEND_MONEY', actors.rahim, actors.pending.user.phone),
    ).rejects.toMatchObject({ statusCode: 422, code: 'RECEIVER_NOT_ACTIVE' });
    await expect(
      receive('CASH_OUT', actors.rahim, actors.frozenAgent.user.phone),
    ).rejects.toMatchObject({ statusCode: 422, code: 'RECEIVER_NOT_ACTIVE' });
  });

  it.each([
    ['SEND_MONEY', 'rahim', 'karim'],
    ['CASH_IN', 'agent', 'rahim'],
    ['CASH_OUT', 'rahim', 'agent'],
    ['PAYMENT', 'rahim', 'store'],
  ] as const)('accepts a valid %s receiver (%s → %s)', async (flow, from, to) => {
    await expect(receive(flow, actors[from], actors[to].user.phone)).resolves.toBeUndefined();
  });
});

describe('toParty', () => {
  it('shows a person by their masked name', () => {
    expect(toParty(actors.rahim.user)).toEqual({
      name: 'Rahim U***',
      phone: '01711111111',
      role: 'CUSTOMER',
    });
    expect(toParty(actors.agent.user).name).toBe('Abdul K***');
  });

  it("shows a merchant by its shop name, unmasked, and never the owner's name", () => {
    const party = toParty(actors.store.user);
    expect(party).toEqual({ name: 'Salma Store', phone: '01744444444', role: 'MERCHANT' });
    expect(JSON.stringify(party)).not.toContain('Salma Begum');
  });

  it('shows a system wallet (no user) as PocketPay', () => {
    expect(toParty(null)).toEqual({ name: 'PocketPay', phone: null, role: 'SYSTEM' });
  });
});
