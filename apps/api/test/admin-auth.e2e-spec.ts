import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PasswordService } from '../src/admin-auth/password.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('administrator authentication', () => {
  const prisma = new PrismaService();
  const usernames: string[] = [];
  let app: INestApplication;
  let passwordService: PasswordService;

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    passwordService = app.get(PasswordService);
  });

  afterEach(async () => {
    const admins = await prisma.adminAccount.findMany({
      where: { username: { in: usernames } },
      select: { id: true }
    });
    await prisma.adminSession.deleteMany({ where: { adminId: { in: admins.map(({ id }) => id) } } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: admins.map(({ id }) => id) } } });
    usernames.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createAdmin(options: { status?: 'ACTIVE' | 'DISABLED' } = {}) {
    const username = `admin-${randomUUID()}`;
    usernames.push(username);
    const password = 'admin-password-123';
    const admin = await prisma.adminAccount.create({
      data: {
        username,
        displayName: '赛事管理员',
        passwordHash: await passwordService.hash(password),
        platformRole: 'PLATFORM_ADMIN',
        status: options.status ?? 'ACTIVE'
      }
    });
    return { admin, username, password };
  }

  function login(username: string, password: string) {
    return request(app.getHttpServer()).post('/v1/admin/auth/login').send({ username, password });
  }

  it('logs in with valid credentials and exposes the current administrator', async () => {
    const account = await createAdmin();
    const loggedIn = await login(account.username, account.password).expect(200);

    expect(loggedIn.body.admin).toMatchObject({ id: account.admin.id, username: account.username });
    await request(app.getHttpServer())
      .get('/v1/admin/auth/me')
      .set('Authorization', `Bearer ${loggedIn.body.accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.admin.id).toBe(account.admin.id));
  });

  it('uses one generic credential error for unknown, wrong, disabled, and locked accounts', async () => {
    const active = await createAdmin();
    const disabled = await createAdmin({ status: 'DISABLED' });

    const invalidCredentials: Array<readonly [string, string]> = [
      [`unknown-${randomUUID()}`, 'admin-password-123'],
      [active.username, 'wrong-password'],
      [disabled.username, disabled.password]
    ];

    for (const [username, password] of invalidCredentials) {
      await login(username, password)
        .expect(401)
        .expect(({ body }) => expect(body.error.code).toBe('ADMIN_CREDENTIALS_INVALID'));
    }

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await login(active.username, 'wrong-password').expect(401);
    }
    const locked = await prisma.adminAccount.findUniqueOrThrow({ where: { id: active.admin.id } });
    expect(locked.failedLoginCount).toBe(5);
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1_000);
    await login(active.username, active.password)
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('ADMIN_CREDENTIALS_INVALID'));
  });

  it('rotates refresh tokens, rejects replay, and logs out idempotently', async () => {
    const account = await createAdmin();
    const loggedIn = await login(account.username, account.password).expect(200);
    const firstRefreshToken = loggedIn.body.refreshToken as string;
    const rotated = await request(app.getHttpServer())
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: firstRefreshToken })
      .expect(200);

    expect(rotated.body.refreshToken).not.toBe(firstRefreshToken);
    await request(app.getHttpServer())
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: firstRefreshToken })
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('ADMIN_SESSION_REUSED'));
    await request(app.getHttpServer())
      .post('/v1/admin/auth/logout')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(200, { ok: true });
    await request(app.getHttpServer())
      .post('/v1/admin/auth/logout')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(200, { ok: true });
  });

  it('rejects a WeChat access token at the administrator boundary', async () => {
    const suffix = randomUUID();
    const wechat = await request(app.getHttpServer())
      .post('/v1/auth/wechat')
      .send({ code: `test-code-${suffix}` })
      .expect(200);

    await request(app.getHttpServer())
      .get('/v1/admin/auth/me')
      .set('Authorization', `Bearer ${wechat.body.accessToken}`)
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('ADMIN_AUTH_REQUIRED'));

    await prisma.refreshSession.deleteMany({ where: { user: { wechatOpenId: `test-openid-${suffix}` } } });
    await prisma.user.deleteMany({ where: { wechatOpenId: `test-openid-${suffix}` } });
  });
});
