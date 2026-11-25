// The tail of each key's queue: settles when the last fn queued for that key is done.
const tails = new Map<string, Promise<void>>();

/**
 * Runs `fn` once every earlier fn for `key` in this process has finished: one at a time per key,
 * in call order; different keys run in parallel. A throw goes to the caller and frees the key.
 * In memory only: across API instances, callers still need their own lock (e.g. a row lock).
 */
export function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const result = (tails.get(key) ?? Promise.resolve()).then(fn);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  // Drop the entry once nothing is queued behind it, so the map doesn't grow with every user.
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return result;
}
