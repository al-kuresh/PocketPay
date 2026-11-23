/** PRIVATE: KYC images, admin-only via short-lived signed URLs. PUBLIC: profile photos. */
export type StorageAccess = 'PRIVATE' | 'PUBLIC';

/** Where uploaded files live. Three drivers: memory (tests), local (dev), Cloudinary (prod). */
export interface StorageProvider {
  put(o: { key: string; body: Buffer; contentType: string; access: StorageAccess }): Promise<void>;
  delete(key: string, access: StorageAccess): Promise<void>;
  publicUrl(key: string): string;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}
