import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processImage } from '../../src/lib/images';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#EA580C' } });

describe('processImage', () => {
  it('shrinks a wide PNG document to 1600px wide WebP', async () => {
    const png = await solid(2400, 1200).png().toBuffer();
    const out = await processImage(png, { mode: 'document' });
    expect(out).toMatchObject({ width: 1600, height: 800, mime: 'image/webp' });
    expect(out.sizeBytes).toBe(out.data.length);
    expect((await sharp(out.data).metadata()).format).toBe('webp');
  });

  it('never enlarges a small document', async () => {
    const jpg = await solid(300, 200).jpeg().toBuffer();
    const out = await processImage(jpg, { mode: 'document' });
    expect(out).toMatchObject({ width: 300, height: 200 });
  });

  it('crops an avatar to 512x512', async () => {
    const jpg = await solid(1200, 800).jpeg().toBuffer();
    const out = await processImage(jpg, { mode: 'avatar' });
    expect(out).toMatchObject({ width: 512, height: 512 });
  });

  it('strips EXIF metadata', async () => {
    const jpg = await solid(400, 300)
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'x' } } })
      .toBuffer();
    expect((await sharp(jpg).metadata()).exif).toBeDefined();

    const out = await processImage(jpg, { mode: 'document' });
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
  });

  it('rejects text with 415 UNSUPPORTED_FILE_TYPE', async () => {
    await expect(processImage(Buffer.from('hello'), { mode: 'document' })).rejects.toMatchObject({
      statusCode: 415,
      code: 'UNSUPPORTED_FILE_TYPE',
    });
  });

  it('rejects a GIF', async () => {
    const gif = await solid(20, 20).gif().toBuffer();
    await expect(processImage(gif, { mode: 'document' })).rejects.toMatchObject({
      statusCode: 415,
    });
  });

  it('rejects a damaged JPEG with 415, not 500', async () => {
    // Real JPEG magic bytes (so the type check passes), then garbage instead of image data.
    const damaged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0x42)]);
    await expect(processImage(damaged, { mode: 'document' })).rejects.toMatchObject({
      statusCode: 415,
      code: 'UNSUPPORTED_FILE_TYPE',
    });
  });

  it('rejects an image above the 50-megapixel limit', async () => {
    // 10000x10000 of one colour compresses to a few hundred KB but would decode to 300 MB.
    const huge = await solid(10_000, 10_000).png({ compressionLevel: 9 }).toBuffer();
    await expect(processImage(huge, { mode: 'document' })).rejects.toMatchObject({
      statusCode: 415,
    });
  });

  it('rejects a HEIC photo with a message listing the accepted types', async () => {
    // Minimal ISO-BMFF header: box size, "ftyp", brand "heic".
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypheic'),
      Buffer.alloc(16),
    ]);
    await expect(processImage(heic, { mode: 'document' })).rejects.toMatchObject({
      statusCode: 415,
      message: expect.stringContaining('JPEG, PNG or WebP'),
    });
  });
});
