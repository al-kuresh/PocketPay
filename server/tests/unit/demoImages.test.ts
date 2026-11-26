import { describe, expect, it } from 'vitest';
import { demoIdCardSvg, demoKycImages } from '../../src/db/demoImages';
import { isWebp } from '../helpers/images';

describe('demo KYC images', () => {
  it('the ID card says it is a demo and shows only the masked NID', () => {
    for (const side of ['front', 'back'] as const) {
      const svg = demoIdCardSvg({ name: 'Jamal Uddin', nidNumber: '9000000006' }, side);
      expect(svg).toContain('DEMO — NOT A REAL NID');
      expect(svg).toContain('Jamal Uddin');
      expect(svg).toContain('*******006');
      expect(svg).not.toContain('9000000006');
    }
  });

  it('makes three different images that processImage accepts as WebP documents', async () => {
    const images = await demoKycImages({ name: 'Jamal Uddin', nidNumber: '9000000006' });

    const all = [images.nidFront, images.nidBack, images.selfie];
    for (const img of all) {
      expect(isWebp(img.data)).toBe(true);
      expect(img.mime).toBe('image/webp');
      expect(img.width).toBeLessThanOrEqual(1600);
    }
    expect(new Set(all.map((i) => i.data.toString('base64'))).size).toBe(3);
  });
});
