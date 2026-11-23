import type { StorageAccess, StorageProvider } from './types';

/** Test driver: keeps objects in a Map so tests can inspect exactly what was stored. */
export class MemoryStorage implements StorageProvider {
  readonly objects = new Map<string, { body: Buffer; access: StorageAccess; contentType: string }>();

  async put(o: { key: string; body: Buffer; contentType: string; access: StorageAccess }) {
    this.objects.set(o.key, { body: o.body, access: o.access, contentType: o.contentType });
  }

  // Like the real drivers, PRIVATE and PUBLIC are separate places: delete only from the one named.
  async delete(key: string, access: StorageAccess) {
    if (this.objects.get(key)?.access === access) this.objects.delete(key);
  }

  publicUrl(key: string) {
    return `memory://${key}`;
  }

  async signedUrl(key: string, ttlSeconds: number) {
    return `memory://${key}?ttl=${ttlSeconds}`;
  }
}
