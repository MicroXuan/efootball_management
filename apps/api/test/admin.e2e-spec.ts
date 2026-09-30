import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PasswordService } from '../src/admin-auth/password.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('platform administration and league grants', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let passwordService: PasswordService;
  let platformId: string;
  let platformToken: string;
  let managerId: string;
  let managerToken: string;
  let userId: string;
  const publicUserNo = String(700_000 + Math.floor(Math.random() * 299_999));
  const leagueIds: string[] = [];
  const usernames: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    passwordService = app.get(PasswordService);
    const username = `platform-${randomUUID()}`;
    usernames.push(username);
    const platform = await prisma.adminAccount.create({
      data: {
        username,
        displayName: '平台管理员',
        passwordHash: await passwordService.hash('platform-password-123'),
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    platformId = platform.id;
    const login = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ username, password: 'platform-password-123' })
      .expect(200);
    platformToken = login.body.accessToken as string;

    const user = await prisma.user.create({
      data: {
        wechatOpenId: `openid-${randomUUID()}`,
        publicUserNo,
        displayName: '六位编号用户'
      }
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorAdminId: platformId } });
    await prisma.adminSession.deleteMany({ where: { adminId: { in: [platformId, managerId].filter(Boolean) } } });
    await prisma.adminMutationReceipt.deleteMany({
      where: { adminId: { in: [platformId, managerId].filter(Boolean) } }
    });
    await prisma.adminLeagueRole.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.adminAccount.deleteMany({ where: { username: { in: usernames } } });
    if (app) await app.close();
    await prisma.$disconnect();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const key = () => randomUUID();

  it('restricts platform mutations and supports multi-league grants with exact audited scope', async () => {
    const managerUsername = `manager-${randomUUID()}`;
    usernames.push(managerUsername);
    const createdManager = await request(app.getHttpServer())
      .post('/v1/admin/accounts')
      .set(auth(platformToken))
      .set('Idempotency-Key', key())
      .send({
        username: managerUsername,
        displayName: '联赛管理员',
        password: 'manager-password-123'
      })
      .expect(201);
    managerId = createdManager.body.id as string;

    const managerLogin = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ username: managerUsername, password: 'manager-password-123' })
      .expect(200);
    managerToken = managerLogin.body.accessToken as string;

    await request(app.getHttpServer())
      .post('/v1/admin/accounts')
      .set(auth(managerToken))
      .set('Idempotency-Key', key())
      .send({ username: `denied-${randomUUID()}`, displayName: '禁止', password: 'password-123' })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('ADMIN_PLATFORM_ACCESS_DENIED'));

    for (const suffix of ['A', 'B']) {
      const response = await request(app.getHttpServer())
        .post('/v1/admin/platform/leagues')
        .set(auth(platformToken))
        .set('Idempotency-Key', key())
        .send({
          name: `测试联赛 ${suffix}`,
          shortName: `联赛${suffix}`,
          description: '',
          logoUrl: null,
          edition: 'NATIONAL',
          defaultSuperCapacity: 23,
          defaultChampionCapacity: 18,
          defaultPromotionCount: 4
        })
        .expect(201);
      leagueIds.push(response.body.id as string);
    }

    await request(app.getHttpServer())
      .get('/v1/admin/platform/leagues')
      .set(auth(platformToken))
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.filter((league: { id: string }) => leagueIds.includes(league.id))).toHaveLength(2);
      });

    await request(app.getHttpServer())
      .get('/v1/admin/platform/leagues')
      .set(auth(managerToken))
      .expect(403);

    const grantIds: string[] = [];
    for (const leagueId of leagueIds) {
      const grant = await request(app.getHttpServer())
        .post(`/v1/admin/accounts/${managerId}/league-grants`)
        .set(auth(platformToken))
        .set('Idempotency-Key', key())
        .send({ leagueId, role: 'LEAGUE_MANAGER' })
        .expect(201);
      grantIds.push(grant.body.id as string);
    }

    await request(app.getHttpServer())
      .get(`/v1/admin/accounts/${managerId}/league-grants`)
      .set(auth(platformToken))
      .expect(200)
      .expect(({ body }) => expect(body.items.map((grant: { leagueId: string }) => grant.leagueId).sort())
        .toEqual([...leagueIds].sort()));

    await request(app.getHttpServer())
      .get('/v1/admin/auth/me')
      .set(auth(managerToken))
      .expect(200)
      .expect(({ body }) => {
        expect(body.leagueGrants.map((grant: { leagueId: string }) => grant.leagueId).sort())
          .toEqual([...leagueIds].sort());
      });

    await request(app.getHttpServer())
      .get(`/v1/admin/leagues/${leagueIds[0]}/users/${publicUserNo}`)
      .set(auth(managerToken))
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ id: userId, publicUserNo }));

    await request(app.getHttpServer())
      .get(`/v1/admin/leagues/${leagueIds[0]}/users/6543`)
      .set(auth(managerToken))
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_FAILED'));

    await request(app.getHttpServer())
      .delete(`/v1/admin/accounts/${managerId}/league-grants/${grantIds[0]}`)
      .set(auth(platformToken))
      .set('Idempotency-Key', key())
      .send({ expectedVersion: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/v1/admin/accounts/${managerId}/league-grants`)
      .set(auth(platformToken))
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(1));

    await request(app.getHttpServer())
      .get(`/v1/admin/leagues/${leagueIds[0]}/users/${publicUserNo}`)
      .set(auth(managerToken))
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('ADMIN_LEAGUE_ACCESS_DENIED'));

    await request(app.getHttpServer())
      .get(`/v1/admin/leagues/${leagueIds[1]}/users/${publicUserNo}`)
      .set(auth(managerToken))
      .expect(200);

    const reset = await request(app.getHttpServer())
      .post(`/v1/admin/accounts/${managerId}/reset-password`)
      .set(auth(platformToken))
      .set('Idempotency-Key', key())
      .send({ password: 'new-manager-password-123', expectedVersion: 1 })
      .expect(200);
    expect(reset.body.version).toBe(2);

    const logs = await prisma.auditLog.findMany({
      where: { actorAdminId: platformId },
      orderBy: { createdAt: 'asc' }
    });
    expect(logs.map(({ action }) => action)).toEqual(expect.arrayContaining([
      'admin.account.create',
      'admin.league.create',
      'admin.league-grant.create',
      'admin.league-grant.revoke',
      'admin.password.reset'
    ]));
    expect(logs.every((log) => log.actorAdminId === platformId)).toBe(true);
    expect(JSON.stringify(logs.map(({ metadata }) => metadata))).not.toMatch(/password|token/i);
  });
});
