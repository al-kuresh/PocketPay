import { v2 as cloudinary } from 'cloudinary';
import type { StorageAccess, StorageProvider } from './types';

const deliveryType = (access: StorageAccess) => (access === 'PRIVATE' ? 'private' : 'upload');

// Cloudinary stores the format separately from the public_id: "kyc/u1/selfie-x.webp" as a
// public_id would become "kyc/u1/selfie-x.webp.webp" in URLs. Strip it; pass format: 'webp'.
const toPublicId = (key: string) => key.replace(/\.webp$/, '');

/** Production driver. Private assets can only be fetched through signed, expiring URLs. */
export class CloudinaryStorage implements StorageProvider {
  constructor(cloudinaryUrl: string) {
    // cloudinary://<api_key>:<api_secret>@<cloud_name>. env.ts only checks the scheme;
    // a wrong key or secret shows up as an error on the first upload.
    const url = new URL(cloudinaryUrl);
    cloudinary.config({
      cloud_name: url.hostname,
      api_key: decodeURIComponent(url.username),
      api_secret: decodeURIComponent(url.password),
      secure: true,
    });
  }

  put(o: { key: string; body: Buffer; contentType: string; access: StorageAccess }) {
    return new Promise<void>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: toPublicId(o.key),
            resource_type: 'image',
            type: deliveryType(o.access),
            format: 'webp',
            overwrite: false,
          },
          // The SDK rejects with a plain object; wrap it so stack traces and logs work.
          (error) => (error ? reject(new Error(error.message)) : resolve()),
        )
        .end(o.body);
    });
  }

  async delete(key: string, access: StorageAccess) {
    await cloudinary.uploader.destroy(toPublicId(key), {
      resource_type: 'image',
      type: deliveryType(access),
    });
  }

  publicUrl(key: string) {
    return cloudinary.url(toPublicId(key), { secure: true, format: 'webp' });
  }

  async signedUrl(key: string, ttlSeconds: number) {
    return cloudinary.utils.private_download_url(toPublicId(key), 'webp', {
      type: 'private',
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
    });
  }
}
