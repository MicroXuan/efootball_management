import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { GAME_ACCOUNT_USAGE_PORT } from '../src/users/game-account-usage.port.js';

config({ path: '../../.env', quiet: true });

describe('profile and game accounts', () => {
  const prisma = new PrismaService();
  const blockedAccountIds = new Set<string>();
  const createdOpenIds: string[] = [];
  let app: INestApplication;

  beforeAll(async () => {
    await prisma.$connect();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GAME_ACCOUNT_USAGE_PORT)
      .useValue({
        hasActiveReferences: async (accountId: string) => blockedAccountIds.has(accountId)
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { wechatOpenId: { in: createdOpenIds } },
      select: { id: true }
    });
    await prisma.gameAccount.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
    await prisma.user.deleteMany({ where: { wechatOpenId: { in: createdOpenIds } } });
    await app?.close();
    await prisma.$disconnect();
  });

  async function authenticatedUser() {
    if (!app) throw new Error('test app is not initialized');
    const suffix = randomUUID();
    const openId = `test-openid-${suffix}`;
    createdOpenIds.push(openId);
    const response = await request(app.getHttpServer())
      .post('/v1/auth/wechat')
      .send({ code: `test-code-${suffix}` })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { wechatOpenId: openId } });
    return { authorization: `Bearer ${response.body.accessToken}`, user };
  }

  const accountInput = (overrides: Record<string, unknown> = {}) => ({
    platform: 'MOBILE',
    serverRegion: '国际服',
    gamerTag: `player-${randomUUID()}`,
    gameUid: randomUUID(),
    isDefault: false,
    ...overrides
  });

  it('reads and updates only the current profile with completeness', async () => {
    const actor = await authenticatedUser();

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', actor.authorization)
      .expect(200)
      .expect(({ body }) => {
        expect(body.id).toBe(actor.user.id);
        expect(body.profileComplete).toBe(false);
      });

    await request(app.getHttpServer())
      .patch('/v1/me')
      .set('Authorization', actor.authorization)
      .send({ displayName: 'KC', avatarUrl: 'https://example.com/avatar.png', region: '上海' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.displayName).toBe('KC');
        expect(body.profileComplete).toBe(true);
      });

    await request(app.getHttpServer())
      .patch('/v1/me')
      .set('Authorization', actor.authorization)
      .send({ displayName: 'KC', avatarUrl: 'not-a-url', region: '上海' })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_FAILED'));
  });

  it('creates, lists, updates, and deletes an owned game account', async () => {
    const actor = await authenticatedUser();
    const input = accountInput({ isDefault: true });
    const created = await request(app.getHttpServer())
      .post('/v1/me/game-accounts')
      .set('Authorization', actor.authorization)
      .send(input)
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/me/game-accounts')
      .set('Authorization', actor.authorization)
      .expect(200)
      .expect(({ body }) => expect(body).toHaveLength(1));

    await request(app.getHttpServer())
      .patch(`/v1/me/game-accounts/${created.body.id}`)
      .set('Authorization', actor.authorization)
      .send({ ...input, gamerTag: 'updated-player' })
      .expect(200)
      .expect(({ body }) => expect(body.gamerTag).toBe('updated-player'));

    await request(app.getHttpServer())
      .delete(`/v1/me/game-accounts/${created.body.id}`)
      .set('Authorization', actor.authorization)
      .expect(200, { ok: true });
  });

  it('hides another user account behind the not-found response', async () => {
    const owner = await authenticatedUser();
    const stranger = await authenticatedUser();
    const created = await request(app.getHttpServer())
      .post('/v1/me/game-accounts')
      .set('Authorization', owner.authorization)
      .send(accountInput())
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/v1/me/game-accounts/${created.body.id}`)
      .set('Authorization', stranger.authorization)
      .send(accountInput())
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('GAME_ACCOUNT_NOT_FOUND'));
  });

  it('returns a stable conflict when a game identity is already bound', async () => {
    const first = await authenticatedUser();
    const second = await authenticatedUser();
    const duplicate = accountInput({ gameUid: `duplicate-${randomUUID()}` });
    await request(app.getHttpServer())
      .post('/v1/me/game-accounts')
      .set('Authorization', first.authorization)
      .send(duplicate)
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/me/game-accounts')
      .set('Authorization', second.authorization)
      .send({ ...duplicate, gamerTag: 'another-name' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('GAME_ACCOUNT_ALREADY_BOUND'));
  });

  it('keeps exactly one default after concurrent default changes', async () => {
    const actor = await authenticatedUser();
    const firstInput = accountInput();
    const secondInput = accountInput();
    const first = await request(app.getHttpServer())
      .post('/v1/me/game-accounts')
      .set('Authorization', actor.authorization)
      .send(firstInput)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/v1/me/game-accounts')
      .set('Authorization', actor.authorization)
      .send(secondInput)
      .expect(201);

    await Promise.all([
      request(app.getHttpServer())
        .patch(`/v1/me/game-accounts/${first.body.id}`)
        .set('Authorization', actor.authorization)
        .send({ ...firstInput, isDefault: true })
        .expect(200),
      request(app.getHttpServer())
        .patch(`/v1/me/game-accounts/${second.body.id}`)
        .set('Authorization', actor.authorization)
        .send({ ...secondInput, isDefault: true })
        .expect(200)
    ]);

    const defaults = await prisma.gameAccount.count({
      where: { userId: actor.user.id, isDefault: true }
    });
    expect(defaults).toBe(1);
  });

  it('refuses deletion while the usage boundary reports active references', async () => {
    const actor = await authenticatedUser();
    const created = await request(app.getHttpServer())
      .post('/v1/me/game-accounts')
      .set('Authorization', actor.authorization)
      .send(accountInput())
      .expect(201);
    blockedAccountIds.add(created.body.id);

    await request(app.getHttpServer())
      .delete(`/v1/me/game-accounts/${created.body.id}`)
      .set('Authorization', actor.authorization)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('GAME_ACCOUNT_IN_USE'));
  });
});
