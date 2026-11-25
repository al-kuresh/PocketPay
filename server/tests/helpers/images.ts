import sharp from 'sharp';

/** A real JPEG made in code (no fixture files). Different colours give different bytes. */
export const testJpeg = (width = 800, height = 600, background = '#EA580C') =>
  sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer();

/** A real ~9 MB PNG: random noise doesn't compress, so 1850×1850×3 stays near 9 MB. */
export const bigPng = () =>
  sharp({
    create: { width: 1850, height: 1850, channels: 3, background: '#888', noise: { type: 'gaussian', mean: 128, sigma: 40 } },
  })
    .png()
    .toBuffer();

/** True when `buf` is a WebP file (RIFF container with a WEBP form type). */
export const isWebp = (buf: Buffer) =>
  buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
  buf.subarray(8, 12).toString('latin1') === 'WEBP';
