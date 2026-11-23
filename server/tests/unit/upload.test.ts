import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { uploadKycImages } from '../../src/middlewares/upload';

// A tiny app with just the upload middleware, so its errors can be tested in isolation.
const app = express();
app.post('/upload', uploadKycImages, (_req, res) => {
  res.json({ success: true });
});
app.use(errorHandler);

describe('uploadKycImages', () => {
  it('rejects a file under an unexpected field with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('photo', Buffer.from('not used'), 'photo.jpg');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual({ field: 'photo', reason: 'LIMIT_UNEXPECTED_FILE' });
  });
});
