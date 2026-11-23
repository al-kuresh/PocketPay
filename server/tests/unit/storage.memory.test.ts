import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../src/lib/storage/memory';

describe('MemoryStorage', () => {
  it('stores, signs and deletes an object', async () => {
    const storage = new MemoryStorage();
    const body = Buffer.from('image bytes');

    await storage.put({ key: 'kyc/u1/selfie.webp', body, contentType: 'image/webp', access: 'PRIVATE' });
    expect(storage.objects.get('kyc/u1/selfie.webp')).toEqual({
      body,
      access: 'PRIVATE',
      contentType: 'image/webp',
    });
    expect(await storage.signedUrl('kyc/u1/selfie.webp', 300)).toBe(
      'memory://kyc/u1/selfie.webp?ttl=300',
    );

    await storage.delete('kyc/u1/selfie.webp', 'PRIVATE');
    expect(storage.objects.size).toBe(0);
  });
});
