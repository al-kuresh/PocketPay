import type { Env } from '../../config/env';
import { CloudinaryStorage } from './cloudinary';
import { LocalStorage } from './local';
import type { StorageProvider } from './types';

export type { StorageAccess, StorageProvider } from './types';

/** Pick the storage driver from STORAGE_DRIVER. Tests inject MemoryStorage instead. */
export function createStorage(e: Pick<Env, 'STORAGE_DRIVER' | 'CLOUDINARY_URL' | 'FILE_URL_SECRET'>): StorageProvider {
  if (e.STORAGE_DRIVER === 'cloudinary') {
    if (!e.CLOUDINARY_URL) throw new Error('CLOUDINARY_URL is required when STORAGE_DRIVER=cloudinary');
    return new CloudinaryStorage(e.CLOUDINARY_URL);
  }
  if (!e.FILE_URL_SECRET) throw new Error('FILE_URL_SECRET is required when STORAGE_DRIVER=local');
  return new LocalStorage(undefined, e.FILE_URL_SECRET);
}
