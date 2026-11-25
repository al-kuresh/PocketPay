import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { invalidPin, verifyPinWithLockout } from '../src/modules/auth/pinLockout';
import { createActor } from './helpers/actors';
import { resetDb } from './helpers/db';

const PHONE = '01712345678';
const PIN = '48213';
const WRONG_PIN = '48214';
const MINUTE = 60_000;

let userId: string;
beforeEach(async () => {
  await resetDb();
  ({
    user: { id: userId },
  } = await createActor({ phone: PHONE, nid: '1234567890', role: 'CUSTOMER', pin: PIN }));
});
afterAll(() => prisma.$disconnect());

const opts = {
  meta: { ip: '127.0.0.1' },
  wrongPin: invalidPin,
  failedAction: 'TRANSACTION_PIN_FAILED' as const,
};
const row = () => prisma.user.findUniqueOrThrow({ where: { id: userId } });
// Like a real request: read the user, then check the PIN against that read.
const attempt = async (pin: string, o = opts) => verifyPinWithLockout(await row(), pin, o);
const audits = (action: string) => prisma.auditLog.findMany({ where: { action } });

describe('verifyPinWithLockout', () => {
  it('resolves on the right PIN and resets the counter', async () => {
    await prisma.user.update({ where: { id: userId }, data: { failedPinAttempts: 2 } });

    await expect(attempt(PIN)).resolves.toBeUndefined();

    expect(await row()).toMatchObject({ failedPinAttempts: 0, lockedUntil: null });
  });

  it('throws what wrongPin(attemptsLeft) returns, counts the attempt and audits it', async () => {
    const wrongPin = vi.fn(invalidPin);

    const err = await attempt(WRONG_PIN, { ...opts, wrongPin }).catch((e: unknown) => e);

    expect(wrongPin).toHaveBeenCalledWith(2);
    expect(err).toBe(wrongPin.mock.results[0]?.value);
    expect(err).toMatchObject({
      statusCode: 403,
      code: 'INVALID_PIN',
      message: 'Wrong PIN',
      details: { attemptsLeft: 2 },
    });
    expect((await row()).failedPinAttempts).toBe(1);
    const logged = await audits('TRANSACTION_PIN_FAILED');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      actorId: userId,
      targetType: 'user',
      targetId: userId,
      metadata: { attemptsLeft: 2 },
      ip: '127.0.0.1',
    });
  });

  it('locks for 30 minutes on the 3rd wrong PIN, with the counter back to 0', async () => {
    await expect(attempt(WRONG_PIN)).rejects.toMatchObject({ details: { attemptsLeft: 2 } });
    await expect(attempt(WRONG_PIN)).rejects.toMatchObject({ details: { attemptsLeft: 1 } });

    const third = await attempt(WRONG_PIN).catch((e: unknown) => e);

    expect(third).toMatchObject({ statusCode: 423, code: 'ACCOUNT_LOCKED' });
    const user = await row();
    const lockedFor = user.lockedUntil!.getTime() - Date.now();
    expect(lockedFor).toBeGreaterThan(29 * MINUTE);
    expect(lockedFor).toBeLessThanOrEqual(30 * MINUTE);
    expect(user.failedPinAttempts).toBe(0);
    expect(await audits('ACCOUNT_LOCKED')).toHaveLength(1);
    expect(await audits('TRANSACTION_PIN_FAILED')).toHaveLength(2);
  });

  it('refuses even the right PIN while locked', async () => {
    const lockedUntil = new Date(Date.now() + 10 * MINUTE);
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil } });

    await expect(attempt(PIN)).rejects.toMatchObject({
      statusCode: 423,
      code: 'ACCOUNT_LOCKED',
      details: { lockedUntil },
    });
    expect((await row()).failedPinAttempts).toBe(0);
  });

  // The passed-in user is never trusted for the lockout: the row is re-read under its lock.
  it('refuses a user object read before the lock landed (the row is re-read under the lock)', async () => {
    const stale = await row();
    const lockedUntil = new Date(Date.now() + 10 * MINUTE);
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil } });

    await expect(verifyPinWithLockout(stale, PIN, opts)).rejects.toMatchObject({
      statusCode: 423,
      code: 'ACCOUNT_LOCKED',
      details: { lockedUntil },
    });
  });

  it('compares at most 3 PINs when 5 wrong PINs arrive in parallel', async () => {
    const user = await row();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => verifyPinWithLockout(user, WRONG_PIN, opts)),
    );

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const codes = results.map((r) => (r as PromiseRejectedResult).reason.code);
    expect(codes.filter((c) => c === 'INVALID_PIN')).toHaveLength(2);
    expect(codes.filter((c) => c === 'ACCOUNT_LOCKED')).toHaveLength(3);
    // A real lock: every 423 names the lockedUntil that is in the row, ~30 minutes ahead.
    const { lockedUntil } = await row();
    expect(lockedUntil!.getTime() - Date.now()).toBeGreaterThan(29 * MINUTE);
    for (const r of results as PromiseRejectedResult[]) {
      if (r.reason.code === 'ACCOUNT_LOCKED') expect(r.reason.details).toEqual({ lockedUntil });
    }
    // One audit row per bcrypt compare: 2 wrong PINs + the lock.
    const compares = await prisma.auditLog.count({
      where: { action: { in: ['TRANSACTION_PIN_FAILED', 'ACCOUNT_LOCKED'] } },
    });
    expect(compares).toBeLessThanOrEqual(3);
  });

  it('lets 5 parallel RIGHT PINs all pass, with no lock and the counter at 0', async () => {
    const user = await row();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => verifyPinWithLockout(user, PIN, opts)),
    );

    expect(results.map((r) => r.status)).toEqual(Array(5).fill('fulfilled'));
    expect(await row()).toMatchObject({ failedPinAttempts: 0, lockedUntil: null });
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("queues one user's PIN checks in memory: never more than 1 open DB transaction for them", async () => {
    const user = await row();
    // Test files run one at a time (vitest.config.ts), so any session waiting on a lock is ours.
    // Without the queue, 4 of the 5 checks would sit in Postgres on the row lock, each holding
    // a pool connection; with it, they wait in memory and no session ever waits on a lock.
    const lockWaits = async () =>
      Number(
        (
          await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'`
        )[0]!.n,
      );
    let done = false;
    let maxWaiting = 0;
    const checks = Promise.all(
      Array.from({ length: 5 }, () => verifyPinWithLockout(user, PIN, opts)),
    ).finally(() => {
      done = true;
    });
    while (!done) {
      maxWaiting = Math.max(maxWaiting, await lockWaits());
      await new Promise((r) => setTimeout(r, 5));
    }
    await checks;

    expect(maxWaiting).toBe(0);
    expect(await row()).toMatchObject({ failedPinAttempts: 0, lockedUntil: null });
  });

  it('shares the counter with login: 2 wrong money PINs, then a wrong login locks', async () => {
    await expect(attempt(WRONG_PIN)).rejects.toMatchObject({ code: 'INVALID_PIN' });
    await expect(attempt(WRONG_PIN)).rejects.toMatchObject({ code: 'INVALID_PIN' });

    const res = await request(createApp({ storage: new MemoryStorage() }))
      .post('/api/v1/auth/login')
      .send({ phone: PHONE, pin: WRONG_PIN });

    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect((await row()).lockedUntil).not.toBeNull();
  });
});
