import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('authentication', () => {
  const prisma = new PrismaService();
  const createdOpenIds: string[] = [];
  let app: INestApplication;

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { wechatOpenId: { in: createdOpenIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  function loginCode(): { code: string; openId: string } {
    const suffix = randomUUID();
    const openId = `test-openid-${suffix}`;
    createdOpenIds.push(openId);
    return { code: `test-code-${suffix}`, openId };
  }

  function login(code: string) {
    return request(app.getHttpServer()).post('/v1/auth/wechat').send({ code });
  }

  it('creates one user on first login and reuses it on repeated login', async () => {
    const identity = loginCode();

    const [first, second] = await Promise.all([
      login(identity.code).expect(200),
      login(identity.code).expect(200)
    ]);
    const users = await prisma.user.findMany({ where: { wechatOpenId: identity.openId } });

    expect(first.body.accessToken).toEqual(expect.any(String));
    expect(first.body.refreshToken).toEqual(expect.any(String));
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);
    expect(users).toHaveLength(1);
    expect(users[0]?.displayName).toBe('实况玩家');
    expect(users[0]?.publicUserNo).toMatch(/^\d{6}$/);
  });

  it('rotates refresh tokens and rejects replayed tokens', async () => {
    const identity = loginCode();
    const loggedIn = await login(identity.code).expect(200);

    const rotated = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: loggedIn.body.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(loggedIn.body.refreshToken);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: loggedIn.body.refreshToken })
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('AUTH_SESSION_REUSED'));

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('logs out idempotently and revokes the refresh token', async () => {
    const identity = loginCode();
    const loggedIn = await login(identity.code).expect(200);
    const body = { refreshToken: loggedIn.body.refreshToken };

    await request(app.getHttpServer()).post('/v1/auth/logout').send(body).expect(200, { ok: true });
    await request(app.getHttpServer()).post('/v1/auth/logout').send(body).expect(200, { ok: true });
    await request(app.getHttpServer()).post('/v1/auth/refresh').send(body).expect(401);
  });

  it('prevents disabled users from logging in or refreshing', async () => {
    const identity = loginCode();
    const loggedIn = await login(identity.code).expect(200);
    await prisma.user.update({
      where: { wechatOpenId: identity.openId },
      data: { status: 'DISABLED' }
    });

    await login(identity.code)
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('AUTH_USER_DISABLED'));
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: loggedIn.body.refreshToken })
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('AUTH_USER_DISABLED'));
  });
});
