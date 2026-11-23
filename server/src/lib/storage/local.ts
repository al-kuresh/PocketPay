import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../utils/AppError';
import type { StorageAccess, StorageProvider } from './types';

/** Relative to the server's working directory; git-ignored. app.ts serves its public/ half. */
export const LOCAL_UPLOADS_DIR = 'uploads';

/** Dev driver: writes files to uploads/{private|public}/{key}. */
export class LocalStorage implements StorageProvider {
  constructor(private readonly rootDir: string = LOCAL_UPLOADS_DIR) {}

  private filePath(key: string, access: StorageAccess) {
    const folder = path.resolve(this.rootDir, access === 'PRIVATE' ? 'private' : 'public');
    const file = path.resolve(folder, key);
    // Keys are server-generated, but a bug must never write (or delete) outside the folder.
    if (!file.startsWith(folder + path.sep)) throw new Error(`Storage key escapes its folder: ${key}`);
    return file;
  }

  async put(o: { key: string; body: Buffer; contentType: string; access: StorageAccess }) {
    const file = this.filePath(o.key, o.access);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, o.body, { flag: 'wx' }); // 'wx': never overwrite an existing file
  }

  async delete(key: string, access: StorageAccess) {
    await rm(this.filePath(key, access), { force: true });
  }

  publicUrl(key: string) {
    return `/uploads/${key}`;
  }

  async signedUrl(): Promise<string> {
    // The admin KYC viewer (Phase 7) will need this; until then, only Cloudinary signs URLs.
    throw new AppError(501, 'NOT_IMPLEMENTED', 'Signed URLs are not available with local storage');
  }
}
