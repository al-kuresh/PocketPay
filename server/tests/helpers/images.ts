import sharp from 'sharp';

/** A real JPEG made in code (no fixture files). Different colours give different bytes. */
export const testJpeg = (width = 800, height = 600, background = '#EA580C') =>
  sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer();

/** True when `buf` is a WebP file (RIFF container with a WEBP form type). */
export const isWebp = (buf: Buffer) =>
  buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
  buf.subarray(8, 12).toString('latin1') === 'WEBP';
