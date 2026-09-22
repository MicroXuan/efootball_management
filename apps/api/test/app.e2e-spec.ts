import request from 'supertest';
import { createTestApp } from './test-app.js';

describe('health', () => {
  it('returns a versioned health response', async () => {
    const app = await createTestApp();

    await request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ok');
        expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
      });

    await app.close();
  });

  it('returns the stable API error envelope for an unknown route', async () => {
    const app = await createTestApp();

    await request(app.getHttpServer())
      .get('/v1/missing')
      .expect(404)
      .expect(({ body, headers }) => {
        expect(body.error.code).toBe('NOT_FOUND');
        expect(body.error.message).toBe('Cannot GET /v1/missing');
        expect(body.error.requestId).toEqual(expect.any(String));
        expect(headers['x-request-id']).toBe(body.error.requestId);
      });

    await app.close();
  });
});
