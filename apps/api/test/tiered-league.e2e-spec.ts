import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PasswordService } from '../src/admin-auth/password.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('tiered league lifecycle API', () => {
  const prisma = new PrismaService();
  const suffix = randomUUID();
  const userIds: string[] = [];
  const userTokenById = new Map<string, string>();
  let app: INestApplication;
  let adminId = '';
  let adminToken = '';
  let leagueId = '';
  let seasonId = '';
  let competitionId = '';

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    const passwords = app.get(PasswordService);
    const admin = await prisma.adminAccount.create({
      data: {
        username: `tiered-e2e-${suffix}`,
        displayName: '分级联赛管理员',
        passwordHash: await passwords.hash('tiered-password-123'),
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    adminId = admin.id;
    const adminLogin = await request(app.getHttpServer()).post('/v1/admin/auth/login')
      .send({ username: admin.username, password: 'tiered-password-123' }).expect(200);
    adminToken = adminLogin.body.accessToken as string;

    for (let index = 1; index <= 20; index += 1) {
      const login = await request(app.getHttpServer()).post('/v1/auth/wechat')
        .send({ code: `test-code-tiered-${index}-${suffix}` }).expect(200);
      const user = await prisma.user.findUniqueOrThrow({
        where: { wechatOpenId: `test-openid-tiered-${index}-${suffix}` }
      });
      userIds.push(user.id);
      userTokenById.set(user.id, login.body.accessToken as string);
    }

    const league = await prisma.league.create({
      data: {
        name: `分级联赛 E2E ${suffix}`, shortName: '分级联赛', defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN', createdByAdminId: adminId
      }
    });
    leagueId = league.id;
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId, seasonNumber: 1, displayName: 'S1 分级联赛', isFirstSeason: true,
        registrationOpensAt: new Date('2026-09-01T00:00:00Z'),
        registrationClosesAt: new Date('2026-09-08T00:00:00Z'),
        startsAt: new Date('2026-09-09T00:00:00Z'), endsAt: new Date('2026-12-31T00:00:00Z'),
        superCapacity: 23, championCapacity: 18, promotionCount: 4,
        status: 'ALLOCATION_REVIEW', createdByAdminId: adminId
      }
    });
    seasonId = season.id;
    await prisma.league.update({ where: { id: leagueId }, data: { currentSeasonId: seasonId } });
    for (let index = 0; index < 19; index += 1) {
      const team = await prisma.leagueTeam.create({
        data: {
          leagueId, ownerUserId: userIds[index]!, teamNumber: index + 1,
          name: `分级球队 ${index + 1}`, shortName: `球队${index + 1}`
        }
      });
      await prisma.seasonEntry.create({
        data: {
          seasonId, leagueTeamId: team.id, ownerUserId: userIds[index]!, source: 'NEW_APPLICATION',
          status: 'APPROVED', teamNameSnapshot: team.name, teamShortNameSnapshot: team.shortName,
          teamNumberSnapshot: team.teamNumber, leagueEditionSnapshot: 'INTERNATIONAL'
        }
      });
    }
  });

  afterAll(async () => {
    const competitions = await prisma.competition.findMany({ where: { seasonId }, select: { id: true } });
    const ids = competitions.map(({ id }) => id);
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.standingsRow.deleteMany({ where: { snapshot: { competitionId: { in: ids } } } });
    await prisma.standingsSnapshot.deleteMany({ where: { competitionId: { in: ids } } });
    await prisma.competitionMatch.updateMany({ where: { stage: { competitionId: { in: ids } } }, data: { officialResultVersionId: null } });
    await prisma.matchResultVersion.deleteMany({ where: { match: { stage: { competitionId: { in: ids } } } } });
    await prisma.competitionMatch.deleteMany({ where: { stage: { competitionId: { in: ids } } } });
    await prisma.stageParticipant.deleteMany({ where: { stage: { competitionId: { in: ids } } } });
    await prisma.seasonAllocationDecision.deleteMany({ where: { proposal: { seasonId } } });
    await prisma.seasonAllocationProposalRow.deleteMany({ where: { proposal: { seasonId } } });
    await prisma.competitionParticipant.deleteMany({ where: { competitionId: { in: ids } } });
    await prisma.competitionStage.deleteMany({ where: { competitionId: { in: ids } } });
    await prisma.competitionRuleVersion.deleteMany({ where: { competitionId: { in: ids } } });
    await prisma.competition.deleteMany({ where: { id: { in: ids } } });
    await prisma.seasonAllocationProposal.deleteMany({ where: { seasonId } });
    await prisma.auditLog.deleteMany({ where: { leagueId } });
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId } });
    await prisma.seasonEntry.deleteMany({ where: { seasonId } });
    await prisma.league.update({ where: { id: leagueId }, data: { currentSeasonId: null } });
    await prisma.leagueSeason.delete({ where: { id: seasonId } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId } });
    await prisma.league.delete({ where: { id: leagueId } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminSession.deleteMany({ where: { adminId } });
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await app.close();
    await prisma.$disconnect();
  });

  it('allocates 19 teams, publishes two groups, and scopes standings updates', async () => {
    const proposal = await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueId}/seasons/${seasonId}/allocation-proposals`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedSeasonVersion: 1, randomSeed: 20261003 }).expect(201);
    expect(new Set(proposal.body.rows.map((row: { suggestedStageCode: string }) => row.suggestedStageCode)))
      .toEqual(new Set(['CHAMPION_A', 'CHAMPION_B']));
    expect(proposal.body.rows).toHaveLength(19);
    const adjusted = proposal.body.rows.find((row: { suggestedStageCode: string }) => row.suggestedStageCode === 'CHAMPION_A');
    const confirmed = await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueId}/seasons/${seasonId}/allocation-decisions`)
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
      .send({
        proposalId: proposal.body.id, expectedSeasonVersion: 1,
        overrides: [{ seasonEntryId: adjusted.seasonEntryId, targetStageCode: 'CHAMPION_B', reason: '端到端验证人工调整' }]
      }).expect(201);
    competitionId = confirmed.body.competitionId as string;
    expect(confirmed.body).toMatchObject({ stageCount: 2, participantCount: 19, status: 'READY' });

    let expectedSeasonVersion = confirmed.body.version as number;
    for (const stage of confirmed.body.stages as Array<{ id: string; participantCount: number }>) {
      const generated = await request(app.getHttpServer())
        .post(`/v1/admin/leagues/${leagueId}/competition-stages/${stage.id}/schedule/generate`)
        .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
        .send({ expectedStageVersion: 1 }).expect(200);
      expect(generated.body.matchCount).toBe(stage.participantCount * (stage.participantCount - 1) / 2);
      await request(app.getHttpServer())
        .post(`/v1/admin/leagues/${leagueId}/competition-stages/${stage.id}/schedule/publish`)
        .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID())
        .send({ expectedStageVersion: generated.body.version, expectedSeasonVersion }).expect(200);
      expectedSeasonVersion += expectedSeasonVersion === confirmed.body.version ? 1 : 0;
    }

    const match = await prisma.competitionMatch.findFirstOrThrow({
      where: { stage: { competitionId }, status: 'SCHEDULED' },
      include: { homeParticipant: { include: { seasonEntry: true } }, awayParticipant: { include: { seasonEntry: true } } }
    });
    const homeToken = userTokenById.get(match.homeParticipant.seasonEntry!.ownerUserId)!;
    const awayToken = userTokenById.get(match.awayParticipant.seasonEntry!.ownerUserId)!;
    const submitted = await request(app.getHttpServer()).post(`/v1/matches/${match.id}/results`)
      .set('Authorization', `Bearer ${homeToken}`).set('Idempotency-Key', randomUUID())
      .send({ homeScore: 2, awayScore: 1, expectedVersion: match.version }).expect(201);
    await request(app.getHttpServer()).post(`/v1/matches/${match.id}/results/${submitted.body.version}/confirm`)
      .set('Authorization', `Bearer ${awayToken}`).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: match.version + 1 }).expect(200);

    const standings = await request(app.getHttpServer())
      .get(`/v1/me/leagues/${leagueId}/seasons/${seasonId}/division-standings`)
      .set('Authorization', `Bearer ${homeToken}`).expect(200);
    const playedGroup = standings.body.groups.find((group: { stage: { id: string } }) => group.stage.id === match.stageId);
    const untouchedGroup = standings.body.groups.find((group: { stage: { id: string } }) => group.stage.id !== match.stageId);
    expect(playedGroup.standings.version).toBe(1);
    expect(playedGroup.standings.rows.some((row: { played: number }) => row.played === 1)).toBe(true);
    expect(untouchedGroup.standings.version).toBe(0);
    await request(app.getHttpServer())
      .get(`/v1/me/leagues/${leagueId}/seasons/${seasonId}/division-standings`)
      .set('Authorization', `Bearer ${userTokenById.get(userIds[19]!)}`).expect(403);
  });
});
