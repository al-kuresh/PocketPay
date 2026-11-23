import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { AppError } from '../utils/AppError';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
  sizeBytes: number;
  mime: 'image/webp';
}

/**
 * Check an uploaded image by its real content (magic bytes, not the file name), then
 * re-encode it to WebP. Re-encoding drops all metadata, including EXIF GPS location.
 */
export async function processImage(
  input: Buffer,
  opts: { mode: 'document' | 'avatar' },
): Promise<ProcessedImage> {
  const type = await fileTypeFromBuffer(input);
  if (!type || !ALLOWED_MIME.has(type.mime)) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only JPEG, PNG or WebP images are allowed');
  }

  try {
    // limitInputPixels: a tiny, highly compressed file can claim huge dimensions and exhaust
    // memory when decoded ("decompression bomb"). 50 MP is far above any phone camera.
    // rotate() with no angle applies the EXIF orientation, so phone photos stay upright
    // after the metadata (which holds that orientation) is stripped.
    const image = sharp(input, { limitInputPixels: 50_000_000 }).rotate();
    const resized =
      opts.mode === 'document'
        ? image.resize({ width: 1600, withoutEnlargement: true })
        : image.resize(512, 512, { fit: 'cover' });

    const { data, info } = await resized
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, sizeBytes: info.size, mime: 'image/webp' };
  } catch {
    // Right magic bytes but undecodable (truncated, corrupt) or over the pixel limit.
    throw new AppError(
      415,
      'UNSUPPORTED_FILE_TYPE',
      'The image is damaged or not a valid JPEG, PNG or WebP',
    );
  }
}
