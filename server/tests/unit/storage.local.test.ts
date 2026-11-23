import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '../../src/lib/storage/local';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pocketpay-storage-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('LocalStorage', () => {
  it('refuses a key that escapes its folder and writes nothing', async () => {
    const storage = new LocalStorage(root);

    await expect(
      storage.put({
        key: '../escape.webp',
        body: Buffer.from('x'),
        contentType: 'image/webp',
        access: 'PUBLIC',
      }),
    ).rejects.toThrow();

    expect(existsSync(path.join(root, 'escape.webp'))).toBe(false);
  });
});
