import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../utils/AppError';
import type { StorageAccess, StorageProvider } from './types';

/** Relative to the server's working directory; git-ignored. app.ts serves its public/ half. */
export const LOCAL_UPLOADS_DIR = 'uploads';

/** The route in modules/files that serves private files; signedUrl links to it. */
export const SIGNED_FILES_PATH = '/api/v1/files/private/';

// The only private keys registration writes: kyc/<userId>/<kind>-<uuid>.webp.
const SIGNABLE_KEY = /^kyc\/[0-9a-f-]{36}\/[a-z-]+-[0-9a-f-]{36}\.webp$/;

const notFound = () => new AppError(404, 'NOT_FOUND', 'File not found');
const badLink = () =>
  new AppError(403, 'LINK_EXPIRED_OR_INVALID', 'This link has expired or is not valid');

/** Dev driver: writes files to uploads/{private|public}/{key}. */
export class LocalStorage implements StorageProvider {
  constructor(
    private readonly rootDir: string = LOCAL_UPLOADS_DIR,
    // FILE_URL_SECRET. Without it nothing is signed and every signed link is refused.
    private readonly secret?: string,
  ) {}

  private filePath(key: string, access: StorageAccess) {
    const folder = path.resolve(this.rootDir, access === 'PRIVATE' ? 'private' : 'public');
    const file = path.resolve(folder, key);
    // Keys are server-generated, but a bug must never write (or delete) outside the folder.
    if (!file.startsWith(folder + path.sep)) throw new Error(`Storage key escapes its folder: ${key}`);
    return file;
  }

  private sign(key: string, exp: string) {
    if (!this.secret) throw new Error('FILE_URL_SECRET is not set');
    return createHmac('sha256', this.secret).update(`${key}\n${exp}`).digest('base64url');
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

  async signedUrl(key: string, ttlSeconds: number) {
    const exp = String(Math.floor(Date.now() / 1000) + ttlSeconds);
    return `${SIGNED_FILES_PATH}${key}?exp=${exp}&sig=${this.sign(key, exp)}`;
  }

  /**
   * The bytes behind a signed link. 404 for a key that isn't a KYC image or leaves the private
   * folder (checked first, whatever the signature), 403 for an expired or wrong signature,
   * then 404 if the file is gone.
   */
  async readSigned(key: string, exp: unknown, sig: unknown): Promise<Buffer> {
    if (!SIGNABLE_KEY.test(key)) throw notFound();
    let file: string;
    try {
      file = this.filePath(key, 'PRIVATE');
    } catch {
      throw notFound();
    }

    // A repeated ?exp= or ?sig= arrives as an array: refused like any other malformed link.
    if (typeof exp !== 'string' || typeof sig !== 'string' || !/^\d{1,12}$/.test(exp)) throw badLink();
    if (Number(exp) < Math.floor(Date.now() / 1000) || !this.secret) throw badLink();
    const expected = Buffer.from(this.sign(key, exp));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw badLink();

    try {
      return await readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound();
      throw err;
    }
  }
}
