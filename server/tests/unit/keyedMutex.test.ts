import { describe, expect, it } from 'vitest';
import { withKeyLock } from '../../src/lib/keyedMutex';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `fn` under the key while tracking how many fns are inside at once. */
function tracker() {
  let active = 0;
  let max = 0;
  const run = (key: string, ms: number, onStart?: () => void) =>
    withKeyLock(key, async () => {
      active += 1;
      max = Math.max(max, active);
      onStart?.();
      await tick(ms);
      active -= 1;
    });
  return { run, max: () => max };
}

describe('withKeyLock', () => {
  it('runs fns for the same key one at a time, in call order', async () => {
    const t = tracker();
    const started: number[] = [];

    await Promise.all([0, 1, 2, 3, 4].map((i) => t.run('user-1', 5, () => started.push(i))));

    expect(t.max()).toBe(1);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it('runs fns for different keys in parallel', async () => {
    const t = tracker();

    await Promise.all([t.run('user-1', 20), t.run('user-2', 20), t.run('user-3', 20)]);

    expect(t.max()).toBe(3);
  });

  it('returns what fn returns', async () => {
    await expect(withKeyLock('k', async () => 42)).resolves.toBe(42);
  });

  it('passes a throw to its caller and releases the key for the next fn', async () => {
    const failed = withKeyLock('user-1', async () => {
      throw new Error('boom');
    });
    const next = withKeyLock('user-1', async () => 'ran');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ran');
  });
});
