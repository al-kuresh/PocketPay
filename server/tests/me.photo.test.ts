import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { logger } from '../src/lib/logger';
import { prisma } from '../src/lib/prisma';
import { MemoryStorage } from '../src/lib/storage/memory';
import { createActor } from './helpers/actors';
import { resetDb } from './helpers/db';
import { bigPng, isWebp, testJpeg } from './helpers/images';

let storage: MemoryStorage;
let app: ReturnType<typeof createApp>;
let userId: string;
let token: string;
let oldKey: string;
let kycKeys: string[];

/** A user as registration leaves them: 3 private KYC images and a public profile photo. */
beforeEach(async () => {
  await resetDb();
  storage = new MemoryStorage();
  app = createApp({ storage });
  const actor = await createActor({ phone: '01712345678', nid: '1234567890', role: 'CUSTOMER' });
  userId = actor.user.id;
  token = actor.token;

  oldKey = `profile/${userId}/old.webp`;
  kycKeys = ['nid-front', 'nid-back', 'selfie'].map((k) => `kyc/${userId}/${k}.webp`);
  const docs = [
    { kind: 'NID_FRONT', access: 'PRIVATE', storageKey: kycKeys[0]! },
    { kind: 'NID_BACK', access: 'PRIVATE', storageKey: kycKeys[1]! },
    { kind: 'SELFIE', access: 'PRIVATE', storageKey: kycKeys[2]! },
    { kind: 'PROFILE', access: 'PUBLIC', storageKey: oldKey },
  ] as const;
  for (const d of docs) {
    await storage.put({
      key: d.storageKey,
      body: Buffer.from(d.storageKey),
      contentType: 'image/webp',
      access: d.access,
    });
  }
  await prisma.userDocument.createMany({
    data: docs.map((d) => ({
      ...d,
      userId,
      mime: 'image/webp',
      sizeBytes: 10,
      width: 1,
      height: 1,
    })),
  });
  await prisma.user.update({ where: { id: userId }, data: { profilePhotoKey: oldKey } });
});
afterAll(() => prisma.$disconnect());

function putPhoto(file: Buffer | null, auth: string | null = token, filename = 'me.jpg') {
  let req = request(app).put('/api/v1/me/photo');
  if (auth) req = req.set('Authorization', `Bearer ${auth}`);
  if (file) req = req.attach('photo', file, filename);
  return req;
}

const profileKey = async () =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).profilePhotoKey;

describe('PUT /me/photo', () => {
  it('replaces the photo with a 512×512 WebP, EXIF stripped, as a PUBLIC PROFILE document', async () => {
    const jpeg = await sharp(await testJpeg(1200, 900))
      .withMetadata({ exif: { IFD0: { Copyright: 'gps-and-friends' } } })
      .jpeg()
      .toBuffer();

    const res = await putPhoto(jpeg);

    expect(res.status).toBe(200);
    const newKey = (await profileKey())!;
    expect(newKey).not.toBe(oldKey);
    expect(newKey).toMatch(new RegExp(`^profile/${userId}/.+\\.webp$`));
    expect(res.body.data.user).toMatchObject({
      id: userId,
      profilePhotoUrl: storage.publicUrl(newKey),
    });
    expect(res.body.data.user).not.toHaveProperty('pinHash');

    const stored = storage.objects.get(newKey)!;
    expect(stored.access).toBe('PUBLIC');
    expect(isWebp(stored.body)).toBe(true);
    const meta = await sharp(stored.body).metadata();
    expect(meta).toMatchObject({ width: 512, height: 512, format: 'webp' });
    expect(meta.exif).toBeUndefined();

    const doc = await prisma.userDocument.findFirstOrThrow({ where: { storageKey: newKey } });
    expect(doc).toMatchObject({
      userId,
      kind: 'PROFILE',
      access: 'PUBLIC',
      mime: 'image/webp',
      width: 512,
      height: 512,
    });
  });

  it('deletes the old public photo and never touches the NID or selfie', async () => {
    const res = await putPhoto(await testJpeg());

    expect(res.status).toBe(200);
    expect(storage.objects.has(oldKey)).toBe(false);
    for (const key of kycKeys) {
      expect(storage.objects.get(key)).toMatchObject({ access: 'PRIVATE', body: Buffer.from(key) });
    }
    const kyc = await prisma.userDocument.findMany({ where: { userId, access: 'PRIVATE' } });
    expect(kyc.map((d) => d.storageKey).sort()).toEqual([...kycKeys].sort());
    // Only the new PROFILE row is left: the old one pointed at a deleted object.
    const profiles = await prisma.userDocument.findMany({ where: { userId, kind: 'PROFILE' } });
    expect(profiles.map((d) => d.storageKey)).toEqual([await profileKey()]);
  });

  it('shows the new photo on GET /me', async () => {
    const res = await putPhoto(await testJpeg());
    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

    expect(me.body.data.user.profilePhotoUrl).toBe(res.body.data.user.profilePhotoUrl);
  });

  it('works for a user who had no photo yet', async () => {
    await prisma.user.update({ where: { id: userId }, data: { profilePhotoKey: null } });

    const res = await putPhoto(await testJpeg());

    expect(res.status).toBe(200);
    expect(res.body.data.user.profilePhotoUrl).toBe(storage.publicUrl((await profileKey())!));
    expect(storage.objects.has(oldKey)).toBe(true); // not ours to delete: no longer the photo
  });

  it('still succeeds when deleting the old photo fails, and logs only its key', async () => {
    storage.delete = async () => {
      throw new Error('cloud is down');
    };
    const warn = vi.spyOn(logger, 'warn');

    const res = await putPhoto(await testJpeg());

    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toEqual({ key: oldKey });
    warn.mockRestore();
  });

  it('rejects a PDF renamed .jpg by its content (415) and changes nothing', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

    const res = await putPhoto(pdf, token, 'photo.jpg');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await profileKey()).toBe(oldKey);
    expect(storage.objects.size).toBe(4);
  });

  it('accepts a 9 MB image (the limit is 10 MB)', async () => {
    const png = await bigPng();
    expect(png.length).toBeGreaterThan(9 * 1024 * 1024);

    const res = await putPhoto(png, token, 'me.png');

    expect(res.status).toBe(200);
    expect(await profileKey()).not.toBe(oldKey);
  });

  it('rejects an 11 MB file with 413 FILE_TOO_LARGE', async () => {
    const res = await putPhoto(Buffer.alloc(11 * 1024 * 1024));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('rate-limits per USER: the 11th upload in 15 minutes is 429, another user still passes', async () => {
    // Limiters skip when NODE_ENV is 'test'; switch that off for this test only.
    const nodeEnv = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      const small = await testJpeg(64, 64);
      for (let i = 1; i <= 10; i++) {
        expect((await putPhoto(small)).status, `upload ${i}`).toBe(200);
      }
      const blocked = await putPhoto(small);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');

      const other = await createActor({ phone: '01812345678', nid: '1234567891', role: 'CUSTOMER' });
      expect((await putPhoto(small, other.token)).status).toBe(200);
    } finally {
      env.NODE_ENV = nodeEnv;
    }
  });

  it('a FROZEN account (access token still valid) → 403 ACCOUNT_FROZEN, nothing stored', async () => {
    await prisma.user.update({ where: { id: userId }, data: { status: 'FROZEN' } });
    const objects = storage.objects.size;

    const res = await putPhoto(await testJpeg());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
    expect(await profileKey()).toBe(oldKey);
    expect(storage.objects.size).toBe(objects);
  });

  it('no file → 400 MISSING_FILE', async () => {
    const res = await putPhoto(null);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'MISSING_FILE', details: { field: 'photo' } });
  });

  it('no token → 401 before the upload is read', async () => {
    // An 11 MB file would be 413 if the upload were parsed first.
    const res = await putPhoto(Buffer.alloc(11 * 1024 * 1024), null);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(await profileKey()).toBe(oldKey);
  });
});
