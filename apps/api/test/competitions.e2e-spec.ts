import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('competition lifecycle API', () => {
  const prisma = new PrismaService();
  const suffix = randomUUID();
  const openIds: [string, string, string] = [
    `test-openid-competition-admin-${suffix}`,
    `test-openid-competition-manager-${suffix}`,
    `test-openid-competition-player-${suffix}`
  ];
  const competitionIds: string[] = [];
  const gameAccountIds: string[] = [];
  let app: INestApplication;
  let adminToken: string;
  let managerToken: string;
  let playerToken: string;
  let adminUserId: string;
  let managerUserId: string;
  let playerUserId: string;

  const body = {
    name: '接口个人联赛',
    description: '接口测试',
    platform: 'MOBILE',
    serverRegion: 'GLOBAL',
    participantType: 'INDIVIDUAL',
    format: 'ROUND_ROBIN',
    registrationOpensAt: '2026-10-01T00:00:00.000Z',
    registrationClosesAt: '2026-10-08T00:00:00.000Z',
    startsAt: '2026-10-09T00:00:00.000Z',
    endsAt: '2026-10-31T00:00:00.000Z',
    participantLimit: 16
  };

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    const adminLogin = await request(app.getHttpServer()).post('/v1/auth/wechat')
      .send({ code: `test-code-competition-admin-${suffix}` }).expect(200);
    const managerLogin = await request(app.getHttpServer()).post('/v1/auth/wechat')
      .send({ code: `test-code-competition-manager-${suffix}` }).expect(200);
    const playerLogin = await request(app.getHttpServer()).post('/v1/auth/wechat')
      .send({ code: `test-code-competition-player-${suffix}` }).expect(200);
    adminToken = adminLogin.body.accessToken as string;
    managerToken = managerLogin.body.accessToken as string;
    playerToken = playerLogin.body.accessToken as string;
    adminUserId = (await prisma.user.findUniqueOrThrow({ where: { wechatOpenId: openIds[0] } })).id;
    managerUserId = (await prisma.user.findUniqueOrThrow({ where: { wechatOpenId: openIds[1] } })).id;
    playerUserId = (await prisma.user.findUniqueOrThrow({ where: { wechatOpenId: openIds[2] } })).id;
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'PLATFORM_ADMIN' } });
    await prisma.userRoleBinding.create({
      data: { userId: adminUserId, roleId: adminRole.id, scopeType: 'PLATFORM' }
    });
  });

  afterAll(async () => {
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: [adminUserId, managerUserId, playerUserId] } } });
    await prisma.competitionParticipant.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionRegistrationStatusHistory.deleteMany({
      where: { registration: { competitionId: { in: competitionIds } } }
    });
    await prisma.competitionRegistration.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.userRoleBinding.deleteMany({
      where: { OR: [{ userId: { in: [adminUserId, managerUserId] } }, { scopeId: { in: competitionIds } }] }
    });
    await prisma.competitionRuleVersion.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competition.deleteMany({ where: { id: { in: competitionIds } } });
    await prisma.gameAccount.deleteMany({ where: { id: { in: gameAccountIds } } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: [adminUserId, managerUserId, playerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminUserId, managerUserId, playerUserId] } } });
    await app.close();
    await prisma.$disconnect();
  });

  async function createCompetition(key: string = randomUUID(), overrides: Record<string, unknown> = {}) {
    const response = await request(app.getHttpServer())
      .post('/v1/admin/competitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({ ...body, ...overrides })
      .expect(201);
    competitionIds.push(response.body.id as string);
    return response.body as { id: string; version: number };
  }

  it('requires idempotency and validates competition timelines', async () => {
    await request(app.getHttpServer()).post('/v1/admin/competitions')
      .set('Authorization', `Bearer ${adminToken}`).send(body).expect(400)
      .expect(({ body: errorBody }) => expect(errorBody.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED'));
    await request(app.getHttpServer()).post('/v1/admin/competitions')
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ ...body, registrationClosesAt: '2026-09-01T00:00:00.000Z' }).expect(400)
      .expect(({ body: errorBody }) => expect(errorBody.error.code).toBe('VALIDATION_FAILED'));
  });

  it('creates, opens, and lists a competition publicly', async () => {
    const created = await createCompetition('competition-create-1');
    await request(app.getHttpServer())
      .post(`/v1/admin/competitions/${created.id}/open-registration`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: created.version }).expect(200);
    await request(app.getHttpServer()).get('/v1/competitions').expect(200)
      .expect(({ body: page }) => expect(page.items.some((item: { id: string }) => item.id === created.id)).toBe(true));
  });

  it('rejects stale updates and a manager scoped to another competition', async () => {
    const first = await createCompetition();
    const second = await createCompetition();
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'EVENT_MANAGER' } });
    await prisma.userRoleBinding.create({
      data: { userId: managerUserId, roleId: managerRole.id, scopeType: 'COMPETITION', scopeId: first.id }
    });
    await request(app.getHttpServer()).patch(`/v1/admin/competitions/${first.id}`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ name: '首次更新', expectedVersion: 1 }).expect(200);
    await request(app.getHttpServer()).patch(`/v1/admin/competitions/${first.id}`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ name: '过期更新', expectedVersion: 1 }).expect(409)
      .expect(({ body: errorBody }) => expect(errorBody.error.code).toBe('VERSION_CONFLICT'));
    await request(app.getHttpServer()).patch(`/v1/admin/competitions/${second.id}`)
      .set('Authorization', `Bearer ${managerToken}`).set('Idempotency-Key', randomUUID())
      .send({ name: '越权更新', expectedVersion: 1 }).expect(403);
  });

  it('registers a player, exposes the review queue, approves, and withdraws', async () => {
    const created = await createCompetition(randomUUID(), {
      registrationOpensAt: '2026-09-01T00:00:00.000Z',
      registrationClosesAt: '2026-10-08T00:00:00.000Z'
    });
    await request(app.getHttpServer())
      .post(`/v1/admin/competitions/${created.id}/open-registration`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: created.version }).expect(200);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'EVENT_MANAGER' } });
    await prisma.userRoleBinding.create({
      data: { userId: managerUserId, roleId: managerRole.id, scopeType: 'COMPETITION', scopeId: created.id }
    });
    const account = await request(app.getHttpServer()).post('/v1/me/game-accounts')
      .set('Authorization', `Bearer ${playerToken}`)
      .send({ platform: 'MOBILE', serverRegion: 'GLOBAL', gamerTag: `E2E-${suffix}` })
      .expect(201);
    gameAccountIds.push(account.body.id as string);

    const registration = await request(app.getHttpServer())
      .post(`/v1/competitions/${created.id}/registrations`)
      .set('Authorization', `Bearer ${playerToken}`).set('Idempotency-Key', randomUUID())
      .send({ gameAccountId: account.body.id, acceptedRuleVersion: 1 }).expect(201);
    await request(app.getHttpServer()).get(`/v1/competitions/${created.id}/registrations/me`)
      .set('Authorization', `Bearer ${playerToken}`).expect(200)
      .expect(({ body: mine }) => expect(mine.id).toBe(registration.body.id));
    await request(app.getHttpServer()).get(`/v1/admin/competitions/${created.id}/registrations`)
      .set('Authorization', `Bearer ${managerToken}`).expect(200)
      .expect(({ body: queue }) => expect(queue).toHaveLength(1));
    const approved = await request(app.getHttpServer())
      .post(`/v1/admin/competitions/${created.id}/registrations/${registration.body.id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: registration.body.version }).expect(200);
    expect(approved.body.status).toBe('APPROVED');
    await request(app.getHttpServer()).delete(`/v1/competitions/${created.id}/registrations/me`)
      .set('Authorization', `Bearer ${playerToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: approved.body.version }).expect(200)
      .expect(({ body: withdrawn }) => expect(withdrawn.status).toBe('WITHDRAWN'));
  });
});
