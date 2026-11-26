import { Router } from 'express';
import type { LocalStorage } from '../../lib/storage/local';

/** Private files of LocalStorage (dev and demo), behind the links LocalStorage.signedUrl makes. */
export function createFilesRouter(storage: LocalStorage): Router {
  const router = Router();

  // GET /api/v1/files/private/<key>?exp&sig. No login: an <img> can't send the access token, so
  // the signature is the permission. The request log drops the query string, so sig isn't logged.
  router.get('/private/*key', async (req, res) => {
    const key = (req.params as { key: string[] }).key.join('/');
    const body = await storage.readSigned(key, req.query.exp, req.query.sig);
    res
      .set({
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      })
      .send(body);
  });

  return router;
}
