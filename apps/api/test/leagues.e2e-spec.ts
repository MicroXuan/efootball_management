import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('league foundation lifecycle API', () => {
  const prisma = new PrismaService();
  const suffix = randomUUID();
  const identities = ['admin', 'manager', 'player', 'outsider'] as const;
  const userIds: string[] = [];
  const leagueIds: string[] = [];
  const accountIds: string[] = [];
  let app: INestApplication;
  let adminToken: string;
  let managerToken: string;
  let playerToken: string;
  let outsiderToken: string;
  let adminId: string;
  let managerId: string;
  let playerId: string;
  let outsiderId: string;

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    const tokens: string[] = [];
    for (const identity of identities) {
      const login = await request(app.getHttpServer()).post('/v1/auth/wechat')
        .send({ code: `test-code-league-${identity}-${suffix}` }).expect(200);
      tokens.push(login.body.accessToken as string);
      const user = await prisma.user.findUniqueOrThrow({
        where: { wechatOpenId: `test-openid-league-${identity}-${suffix}` }
      });
      userIds.push(user.id);
    }
    [adminToken, managerToken, playerToken, outsiderToken] = tokens as [string, string, string, string];
    [adminId, managerId, playerId, outsiderId] = userIds as [string, string, string, string];
    const platformAdmin = await prisma.role.findUniqueOrThrow({ where: { code: 'PLATFORM_ADMIN' } });
    await prisma.userRoleBinding.create({
      data: { userId: adminId, roleId: platformAdmin.id, scopeType: 'PLATFORM' }
    });
  });

  afterAll(async () => {
    await prisma.seasonEntryStatusHistory.deleteMany({
      where: { seasonEntry: { season: { leagueId: { in: leagueIds } } } }
    });
    await prisma.seasonEntry.updateMany({
      where: { season: { leagueId: { in: leagueIds } } },
      data: { previousSeasonEntryId: null }
    });
    await prisma.seasonEntry.deleteMany({ where: { season: { leagueId: { in: leagueIds } } } });
    await prisma.leagueSeasonStatusHistory.deleteMany({
      where: { season: { leagueId: { in: leagueIds } } }
    });
    await prisma.leagueSeason.updateMany({
      where: { leagueId: { in: leagueIds } },
      data: { previousSeasonId: null }
    });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.userRoleBinding.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { scopeId: { in: leagueIds } }] }
    });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    await prisma.teamProfile.deleteMany({ where: { ownerUserId: { in: userIds } } });
    await prisma.gameAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  const authorization = (token: string) => `Bearer ${token}`;
  const idempotency = () => randomUUID();
  const seasonBody = (seasonNumber: number) => {
    const now = Date.now();
    return {
      seasonNumber,
      displayName: `CELL S${seasonNumber}`,
      registrationOpensAt: new Date(now - 60_000).toISOString(),
      registrationClosesAt: new Date(now + 600_000).toISOString(),
      startsAt: new Date(now + 1_200_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString()
    };
  };

  it('runs creation, application, review, renewal, authorization, and concurrency end to end', async () => {
    const createKey = idempotency();
    const leagueInput = {
      name: `CELL 接口联赛 ${suffix.slice(0, 6)}`,
      shortName: 'CELL E2E',
      description: '联赛基础切片端到端验证',
      logoUrl: null,
      defaultPlatform: 'MOBILE',
      defaultServerRegion: 'GLOBAL'
    };
    const createdLeague = await request(app.getHttpServer()).post('/v1/admin/leagues')
      .set('Authorization', authorization(adminToken)).set('Idempotency-Key', createKey)
      .send(leagueInput).expect(201);
    leagueIds.push(createdLeague.body.id as string);
    const replayedLeague = await request(app.getHttpServer()).post('/v1/admin/leagues')
      .set('Authorization', authorization(adminToken)).set('Idempotency-Key', createKey)
      .send(leagueInput).expect(201);
    expect(replayedLeague.body).toEqual(createdLeague.body);

    const leagueManagerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'LEAGUE_MANAGER' } });
    await prisma.userRoleBinding.create({
      data: {
        userId: managerId,
        roleId: leagueManagerRole.id,
        scopeType: 'LEAGUE',
        scopeId: createdLeague.body.id,
        grantedById: adminId
      }
    });
    const unrelatedLeague = await prisma.league.create({
      data: {
        name: `无关联赛 ${suffix.slice(0, 6)}`,
        shortName: '无关',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: adminId
      }
    });
    leagueIds.push(unrelatedLeague.id);
    await prisma.userRoleBinding.create({
      data: {
        userId: outsiderId,
        roleId: leagueManagerRole.id,
        scopeType: 'LEAGUE',
        scopeId: unrelatedLeague.id,
        grantedById: adminId
      }
    });
    await expect(prisma.userRoleBinding.count({
      where: { userId: adminId, roleId: leagueManagerRole.id, scopeId: createdLeague.body.id }
    })).resolves.toBe(1);

    const account = await request(app.getHttpServer()).post('/v1/me/game-accounts')
      .set('Authorization', authorization(playerToken))
      .send({
        platform: 'MOBILE',
        serverRegion: 'GLOBAL',
        gamerTag: `LeagueE2E-${suffix.slice(0, 8)}`,
        gameUid: `league-e2e-${suffix}`,
        isDefault: true
      }).expect(201);
    accountIds.push(account.body.id as string);
    const profile = await request(app.getHttpServer()).post('/v1/me/team-profile')
      .set('Authorization', authorization(playerToken))
      .send({
        name: '上海申花',
        shortName: '申花',
        logoUrl: null,
        defaultGameAccountId: account.body.id
      }).expect(201);

    const season1 = await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${createdLeague.body.id}/seasons`)
      .set('Authorization', authorization(managerToken)).set('Idempotency-Key', idempotency())
      .send(seasonBody(1)).expect(201);
    await request(app.getHttpServer()).get(`/v1/admin/seasons/${season1.body.id}`)
      .set('Authorization', authorization(outsiderToken)).expect(403);
    await request(app.getHttpServer()).patch(`/v1/admin/seasons/${season1.body.id}`)
      .set('Authorization', authorization(outsiderToken)).set('Idempotency-Key', idempotency())
      .send({ displayName: '越权修改', expectedVersion: season1.body.version }).expect(403);

    const opened1 = await request(app.getHttpServer())
      .post(`/v1/admin/seasons/${season1.body.id}/open-registration`)
      .set('Authorization', authorization(managerToken)).set('Idempotency-Key', idempotency())
      .send({ expectedVersion: season1.body.version }).expect(200);
    await request(app.getHttpServer()).patch(`/v1/admin/seasons/${season1.body.id}`)
      .set('Authorization', authorization(managerToken)).set('Idempotency-Key', idempotency())
      .send({ displayName: '过期版本', expectedVersion: season1.body.version }).expect(409);

    const applicationKey = idempotency();
    const application = await request(app.getHttpServer())
      .post(`/v1/seasons/${season1.body.id}/applications`)
      .set('Authorization', authorization(playerToken)).set('Idempotency-Key', applicationKey)
      .send({ gameAccountId: account.body.id }).expect(201);
    const applicationReplay = await request(app.getHttpServer())
      .post(`/v1/seasons/${season1.body.id}/applications`)
      .set('Authorization', authorization(playerToken)).set('Idempotency-Key', applicationKey)
      .send({ gameAccountId: account.body.id }).expect(201);
    expect(applicationReplay.body).toEqual(application.body);

    await request(app.getHttpServer())
      .get(`/v1/admin/seasons/${season1.body.id}/entries?status=PENDING&source=NEW_APPLICATION`)
      .set('Authorization', authorization(managerToken)).expect(200)
      .expect(({ body }) => expect(body).toEqual([
        expect.objectContaining({ id: application.body.id, status: 'PENDING' })
      ]));
    const approved1 = await request(app.getHttpServer())
      .post(`/v1/admin/seasons/${season1.body.id}/entries/${application.body.id}/approve`)
      .set('Authorization', authorization(managerToken)).set('Idempotency-Key', idempotency())
      .send({ expectedVersion: application.body.version }).expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/seasons/${season1.body.id}/entries/${application.body.id}/reject`)
      .set('Authorization', authorization(managerToken)).set('Idempotency-Key', idempotency())
      .send({ expectedVersion: application.body.version, reason: '过期操作' }).expect(409);

    await request(app.getHttpServer()).patch('/v1/me/team-profile')
      .set('Authorization', authorization(playerToken))
      .send({ name: '上海申花新名', expectedVersion: profile.body.version }).expect(200);
    await request(app.getHttpServer()).get(`/v1/seasons/${season1.body.id}/entries/me`)
      .set('Authorization', authorization(playerToken)).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        id: approved1.body.id,
        teamNameSnapshot: '上海申花'
      }));

    const closed1 = await request(app.getHttpServer())
      .post(`/v1/admin/seasons/${season1.body.id}/close-registration`)
      .set('Authorization', authorization(managerToken)).set('Idempotency-Key', idempotency())
      .send({ expectedVersion: opened1.body.version }).expect(200);
    await request(app.getHttpServer()).delete(`/v1/seasons/${season1.body.id}/entries/me`)
      .set('Authorization', authorization(playerToken)).set('Idempotency-Key', idempotency())
      .send({ expectedVersion: approved1.body.version }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('SEASON_REGISTRATION_CLOSED'));
    await prisma.leagueSeason.update({
      where: { id: season1.body.id },
      data: { status: 'COMPLETED' }
    });

    const season2 = await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${createdLeague.body.id}/seasons`)
      .set('Authorization', authorization(managerToken)).set('Idempotency-Key', idempotency())
      .send(seasonBody(2)).expect(201);
    await request(app.getHttpServer())
      .post(`/v1/admin/seasons/${season2.body.id}/open-registration`)
      .set('Authorization', authorization(managerToken)).set('Idempotency-Key', idempotency())
      .send({ expectedVersion: season2.body.version }).expect(200);
    const invitation = await request(app.getHttpServer())
      .get(`/v1/seasons/${season2.body.id}/entries/me`)
      .set('Authorization', authorization(playerToken)).expect(200);
    expect(invitation.body).toMatchObject({ source: 'RENEWAL', status: 'INVITED' });

    const updatedProfile = await request(app.getHttpServer()).get('/v1/me/team-profile')
      .set('Authorization', authorization(playerToken)).expect(200);
    await request(app.getHttpServer()).patch('/v1/me/team-profile')
      .set('Authorization', authorization(playerToken))
      .send({ name: '上海申花 S2', expectedVersion: updatedProfile.body.version }).expect(200);
    await request(app.getHttpServer())
      .post(`/v1/seasons/${season2.body.id}/renewal/confirm`)
      .set('Authorization', authorization(playerToken)).set('Idempotency-Key', idempotency())
      .send({ gameAccountId: account.body.id, expectedVersion: invitation.body.version }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        status: 'APPROVED',
        teamNameSnapshot: '上海申花 S2'
      }));
    expect(closed1.body.status).toBe('ALLOCATION_REVIEW');
  });
});
