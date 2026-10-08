import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('competition lifecycle API', () => {
  const relativeDate = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString();
  const prisma = new PrismaService();
  const suffix = randomUUID();
  const openIds: [string, string, string] = [
    `test-openid-competition-admin-${suffix}`,
    `test-openid-competition-manager-${suffix}`,
    `test-openid-competition-player-${suffix}`
  ];
  const competitionIds: string[] = [];
  const gameAccountIds: string[] = [];
  const fixtureUserIds: string[] = [];
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
    registrationOpensAt: relativeDate(-1),
    registrationClosesAt: relativeDate(1),
    startsAt: relativeDate(2),
    endsAt: relativeDate(30),
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
    await prisma.standingsRow.deleteMany({ where: { snapshot: { competitionId: { in: competitionIds } } } });
    await prisma.standingsSnapshot.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionMatch.updateMany({
      where: { stage: { competitionId: { in: competitionIds } } }, data: { officialResultVersionId: null }
    });
    await prisma.matchResultVersion.deleteMany({
      where: { match: { stage: { competitionId: { in: competitionIds } } } }
    });
    await prisma.competitionMatch.deleteMany({ where: { stage: { competitionId: { in: competitionIds } } } });
    await prisma.competitionStage.deleteMany({ where: { competitionId: { in: competitionIds } } });
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
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
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

  async function seedParticipants(competitionId: string, count: number) {
    for (let index = 0; index < count; index += 1) {
      const userId = randomUUID();
      fixtureUserIds.push(userId);
      await prisma.user.create({
        data: { id: userId, wechatOpenId: `schedule-e2e-${userId}`, displayName: `赛程 E2E ${index + 1}` }
      });
      const account = await prisma.gameAccount.create({
        data: { userId, platform: 'MOBILE', serverRegion: 'GLOBAL', gamerTag: `ScheduleE2E-${index + 1}-${suffix}` }
      });
      gameAccountIds.push(account.id);
      const registration = await prisma.competitionRegistration.create({
        data: {
          competitionId,
          applicantId: userId,
          gameAccountId: account.id,
          acceptedRuleVersion: 1,
          status: 'APPROVED'
        }
      });
      await prisma.competitionParticipant.create({
        data: {
          competitionId,
          registrationId: registration.id,
          individualUserId: userId,
          admissionSequence: index + 1,
          displayNameSnapshot: `赛程 E2E ${index + 1}`
        }
      });
    }
  }

  it('requires idempotency and validates competition timelines', async () => {
    await request(app.getHttpServer()).post('/v1/admin/competitions')
      .set('Authorization', `Bearer ${adminToken}`).send(body).expect(400)
      .expect(({ body: errorBody }) => expect(errorBody.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED'));
    await request(app.getHttpServer()).post('/v1/admin/competitions')
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ ...body, registrationClosesAt: relativeDate(-2) }).expect(400)
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
    await request(app.getHttpServer()).get(`/v1/admin/competitions/${first.id}`)
      .set('Authorization', `Bearer ${managerToken}`).expect(200)
      .expect(({ body: detail }) => expect(detail.capabilities.canManage).toBe(true));
    await request(app.getHttpServer()).get(`/v1/admin/competitions/${second.id}`)
      .set('Authorization', `Bearer ${managerToken}`).expect(403);
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
      registrationOpensAt: relativeDate(-1),
      registrationClosesAt: relativeDate(1)
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
      .expect(({ body: queue }) => {
        expect(queue).toHaveLength(1);
        expect(queue[0]).toMatchObject({ applicantDisplayName: '实况玩家', gameAccountGamerTag: `E2E-${suffix}` });
      });
    const approved = await request(app.getHttpServer())
      .post(`/v1/admin/competitions/${created.id}/registrations/${registration.body.id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: registration.body.version }).expect(200);
    expect(approved.body.status).toBe('APPROVED');
    await request(app.getHttpServer()).get('/v1/me/competitions?limit=10')
      .set('Authorization', `Bearer ${playerToken}`).expect(200)
      .expect(({ body: dashboard }) => {
        const item = dashboard.items.find((entry: { competition: { id: string } }) => entry.competition.id === created.id);
        expect(item.registration.status).toBe('APPROVED');
      });
    await request(app.getHttpServer()).get('/v1/me/matches?limit=10')
      .set('Authorization', `Bearer ${playerToken}`).expect(200)
      .expect(({ body: matches }) => expect(matches.items).toEqual([]));
    await request(app.getHttpServer()).delete(`/v1/competitions/${created.id}/registrations/me`)
      .set('Authorization', `Bearer ${playerToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: approved.body.version }).expect(200)
      .expect(({ body: withdrawn }) => expect(withdrawn.status).toBe('WITHDRAWN'));
  });

  it('generates, previews, publishes, and exposes a round-robin schedule', async () => {
    const created = await createCompetition();
    const opened = await request(app.getHttpServer())
      .post(`/v1/admin/competitions/${created.id}/open-registration`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: created.version }).expect(200);
    const closed = await request(app.getHttpServer())
      .post(`/v1/admin/competitions/${created.id}/close-registration`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: opened.body.version }).expect(200);
    await seedParticipants(created.id, 4);

    const generated = await request(app.getHttpServer())
      .post(`/v1/admin/competitions/${created.id}/schedule/generate`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(generated.body).toMatchObject({ status: 'DRAFT', roundCount: 3, matchCount: 6 });
    await request(app.getHttpServer())
      .get(`/v1/admin/competitions/${created.id}/schedule/preview`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200)
      .expect(({ body: preview }) => expect(preview.matches).toHaveLength(6));
    await request(app.getHttpServer()).get(`/v1/competitions/${created.id}/matches`)
      .expect(200).expect([]);

    const published = await request(app.getHttpServer())
      .post(`/v1/admin/competitions/${created.id}/schedule/publish`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({
        expectedCompetitionVersion: closed.body.version,
        expectedStageVersion: generated.body.version
      }).expect(200)
      .expect(({ body: published }) => expect(published.status).toBe('PUBLISHED'));
    const publicMatches = await request(app.getHttpServer()).get(`/v1/competitions/${created.id}/matches`)
      .expect(200).expect(({ body: matches }) => {
        expect(matches).toHaveLength(6);
        expect(matches.map((match: { matchNumber: number }) => match.matchNumber)).toEqual([1, 2, 3, 4, 5, 6]);
      });
    await request(app.getHttpServer()).post(`/v1/admin/competitions/${created.id}/start`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: closed.body.version + 1 }).expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/competitions/${created.id}/matches/${publicMatches.body[0].id}/results`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ homeScore: 2, awayScore: 1, expectedVersion: 2 }).expect(200)
      .expect(({ body: result }) => expect(result.status).toBe('OFFICIAL'));
    await request(app.getHttpServer()).get(`/v1/competitions/${created.id}/standings`)
      .expect(200).expect(({ body: standings }) => {
        expect(standings.version).toBe(1);
        expect(standings.rows).toHaveLength(4);
        expect(standings.rows[0]).toMatchObject({ played: 1, wins: 1, totalPoints: 3 });
      });
    expect(published.body.matchCount).toBe(6);
  });
});
