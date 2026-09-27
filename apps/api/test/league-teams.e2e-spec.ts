import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PasswordService } from '../src/admin-auth/password.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('league-scoped team API', () => {
  const prisma = new PrismaService();
  const suffix = randomUUID();
  let app: INestApplication;
  let platformId: string;
  let managerId: string;
  let managerToken: string;
  let playerId: string;
  let playerToken: string;
  let playerAccountId: string;
  let secondUserId: string;
  let secondAccountId: string;
  const leagueIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    const passwords = app.get(PasswordService);
    const platform = await prisma.adminAccount.create({
      data: {
        username: `team-platform-${suffix}`,
        displayName: '平台管理员',
        passwordHash: await passwords.hash('platform-password-123'),
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    platformId = platform.id;
    const manager = await prisma.adminAccount.create({
      data: {
        username: `team-manager-${suffix}`,
        displayName: '联赛管理员',
        passwordHash: await passwords.hash('manager-password-123'),
        platformRole: 'LEAGUE_MANAGER'
      }
    });
    managerId = manager.id;
    const managerLogin = await request(app.getHttpServer()).post('/v1/admin/auth/login')
      .send({ username: manager.username, password: 'manager-password-123' }).expect(200);
    managerToken = managerLogin.body.accessToken as string;

    const playerLogin = await request(app.getHttpServer()).post('/v1/auth/wechat')
      .send({ code: `test-code-league-team-${suffix}` }).expect(200);
    playerToken = playerLogin.body.accessToken as string;
    const player = await prisma.user.findUniqueOrThrow({
      where: { wechatOpenId: `test-openid-league-team-${suffix}` }
    });
    playerId = player.id;
    const playerAccount = await prisma.gameAccount.create({
      data: {
        userId: player.id,
        platform: 'MOBILE',
        serverRegion: 'GLOBAL',
        gamerTag: `Player-${suffix}`,
        isDefault: true
      }
    });
    playerAccountId = playerAccount.id;

    const second = await prisma.user.create({
      data: {
        wechatOpenId: `second-${suffix}`,
        publicUserNo: String(700_000 + Math.floor(Math.random() * 299_999)),
        displayName: '第二位用户'
      }
    });
    secondUserId = second.id;
    const secondAccount = await prisma.gameAccount.create({
      data: {
        userId: second.id,
        platform: 'MOBILE',
        serverRegion: 'GLOBAL',
        gamerTag: `Second-${suffix}`,
        isDefault: true
      }
    });
    secondAccountId = secondAccount.id;

    for (const label of ['一', '二']) {
      const league = await prisma.league.create({
        data: {
          name: `球队接口联赛${label}-${suffix}`,
          shortName: `联赛${label}`,
          defaultPlatform: 'MOBILE',
          defaultServerRegion: 'GLOBAL',
          createdByAdminId: platformId
        }
      });
      leagueIds.push(league.id);
    }
    await prisma.adminLeagueRole.create({
      data: {
        adminId: managerId,
        leagueId: leagueIds[0]!,
        grantedById: platformId
      }
    });
  });

  afterAll(async () => {
    await prisma.seasonEntryStatusHistory.deleteMany({
      where: { seasonEntry: { season: { leagueId: { in: leagueIds } } } }
    });
    await prisma.seasonEntry.deleteMany({ where: { season: { leagueId: { in: leagueIds } } } });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.auditLog.deleteMany({ where: { actorAdminId: { in: [platformId, managerId] } } });
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId: { in: [platformId, managerId] } } });
    await prisma.adminSession.deleteMany({ where: { adminId: { in: [platformId, managerId] } } });
    await prisma.adminLeagueRole.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    await prisma.gameAccount.deleteMany({ where: { id: { in: [playerAccountId, secondAccountId] } } });
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: [playerId, secondUserId] } } });
    await prisma.refreshSession.deleteMany({ where: { userId: playerId } });
    await prisma.user.deleteMany({ where: { id: { in: [playerId, secondUserId] } } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: [platformId, managerId] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const adminAuth = () => ({ Authorization: `Bearer ${managerToken}` });
  const key = () => randomUUID();

  it('enforces manager scope and exposes independent user teams with immutable season snapshots', async () => {
    const first = await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueIds[0]}/teams`)
      .set(adminAuth()).set('Idempotency-Key', key())
      .send({
        ownerUserId: playerId,
        teamNumber: 8,
        name: '第一赛季球队名',
        shortName: '一队',
        logoUrl: null,
        defaultGameAccountId: playerAccountId
      }).expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueIds[0]}/teams`)
      .set(adminAuth()).set('Idempotency-Key', key())
      .send({
        ownerUserId: playerId,
        teamNumber: 9,
        name: '重复所有者',
        shortName: '重复',
        logoUrl: null,
        defaultGameAccountId: playerAccountId
      }).expect(409);

    await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueIds[0]}/teams`)
      .set(adminAuth()).set('Idempotency-Key', key())
      .send({
        ownerUserId: secondUserId,
        teamNumber: 8,
        name: '重复编号',
        shortName: '重号',
        logoUrl: null,
        defaultGameAccountId: secondAccountId
      }).expect(409);

    await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueIds[1]}/teams`)
      .set(adminAuth()).set('Idempotency-Key', key())
      .send({
        ownerUserId: playerId,
        teamNumber: 8,
        name: '跨联赛球队',
        shortName: '二队',
        logoUrl: null,
        defaultGameAccountId: playerAccountId
      }).expect(403);

    await prisma.adminLeagueRole.create({
      data: { adminId: managerId, leagueId: leagueIds[1]!, grantedById: platformId }
    });
    const secondLeagueTeam = await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueIds[1]}/teams`)
      .set(adminAuth()).set('Idempotency-Key', key())
      .send({
        ownerUserId: playerId,
        teamNumber: 8,
        name: '跨联赛球队',
        shortName: '二队',
        logoUrl: null,
        defaultGameAccountId: playerAccountId
      }).expect(201);

    expect(secondLeagueTeam.body.id).toEqual(expect.any(String));
    await request(app.getHttpServer())
      .get(`/v1/admin/leagues/${leagueIds[0]}/teams/${secondLeagueTeam.body.id}`)
      .set(adminAuth()).expect(404);

    await request(app.getHttpServer()).get('/v1/me/league-teams')
      .set('Authorization', `Bearer ${playerToken}`).expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(2));

    const now = Date.now();
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId: leagueIds[0]!,
        seasonNumber: 1,
        displayName: 'S1',
        isFirstSeason: true,
        registrationOpensAt: new Date(now - 60_000),
        registrationClosesAt: new Date(now + 600_000),
        startsAt: new Date(now + 1_200_000),
        endsAt: new Date(now + 3_600_000),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        status: 'REGISTRATION_OPEN',
        createdById: playerId
      }
    });
    const application = await request(app.getHttpServer())
      .post(`/v1/seasons/${season.id}/applications`)
      .set('Authorization', `Bearer ${playerToken}`).set('Idempotency-Key', key())
      .send({ gameAccountId: playerAccountId }).expect(201);
    expect(application.body).toMatchObject({
      leagueTeamId: first.body.id,
      teamNumberSnapshot: 8,
      teamNameSnapshot: '第一赛季球队名'
    });

    const renamed = await request(app.getHttpServer())
      .patch(`/v1/admin/leagues/${leagueIds[0]}/teams/${first.body.id}`)
      .set(adminAuth()).set('Idempotency-Key', key())
      .send({ name: '后来改名', expectedVersion: first.body.version }).expect(200);
    await request(app.getHttpServer())
      .patch(`/v1/admin/leagues/${leagueIds[0]}/teams/${first.body.id}`)
      .set(adminAuth()).set('Idempotency-Key', key())
      .send({ teamNumber: 18, expectedVersion: renamed.body.version }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('LEAGUE_TEAM_NUMBER_LOCKED'));
    await request(app.getHttpServer()).get(`/v1/seasons/${season.id}/entries/me`)
      .set('Authorization', `Bearer ${playerToken}`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        teamNumberSnapshot: 8,
        teamNameSnapshot: '第一赛季球队名'
      }));
  });
});
