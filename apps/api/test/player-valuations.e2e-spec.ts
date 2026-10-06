import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PasswordService } from '../src/admin-auth/password.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { defaultSalaryTiers } from '../src/league-rosters/salary-rules.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('player valuation end-to-end flow', () => {
  const prisma = new PrismaService();
  const suffix = randomUUID();
  let app: INestApplication;
  let adminId: string;
  let adminToken: string;
  let ownerId: string;
  let ownerToken: string;
  let outsiderId: string;
  let outsiderToken: string;
  let leagueId: string;
  let seasonId: string;
  let teamId: string;
  let sourceId: string;
  let playerId: string;

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    const passwords = app.get(PasswordService);
    const admin = await prisma.adminAccount.create({
      data: {
        username: `valuation-e2e-${suffix}`,
        displayName: '身价验收管理员',
        passwordHash: await passwords.hash('valuation-password-123'),
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    adminId = admin.id;
    const adminLogin = await request(app.getHttpServer()).post('/v1/admin/auth/login')
      .send({ username: admin.username, password: 'valuation-password-123' }).expect(200);
    adminToken = adminLogin.body.accessToken as string;

    const ownerLogin = await request(app.getHttpServer()).post('/v1/auth/wechat')
      .send({ code: `test-code-valuation-owner-${suffix}` }).expect(200);
    ownerToken = ownerLogin.body.accessToken as string;
    const owner = await prisma.user.findUniqueOrThrow({
      where: { wechatOpenId: `test-openid-valuation-owner-${suffix}` }
    });
    ownerId = owner.id;
    const outsiderLogin = await request(app.getHttpServer()).post('/v1/auth/wechat')
      .send({ code: `test-code-valuation-outsider-${suffix}` }).expect(200);
    outsiderToken = outsiderLogin.body.accessToken as string;
    const outsider = await prisma.user.findUniqueOrThrow({
      where: { wechatOpenId: `test-openid-valuation-outsider-${suffix}` }
    });
    outsiderId = outsider.id;

    const league = await prisma.league.create({
      data: {
        name: `身价闭环联赛-${suffix}`,
        shortName: '身价闭环',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN',
        createdByAdminId: adminId
      }
    });
    leagueId = league.id;
    const now = Date.now();
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId,
        seasonNumber: 1,
        displayName: '身价验收赛季',
        isFirstSeason: true,
        registrationOpensAt: new Date(now - 86_400_000),
        registrationClosesAt: new Date(now - 43_200_000),
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 86_400_000),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        status: 'IN_PROGRESS',
        createdByAdminId: adminId
      }
    });
    seasonId = season.id;
    await prisma.league.update({ where: { id: leagueId }, data: { currentSeasonId: seasonId } });
    const shell = await prisma.teamCatalogItem.create({
      data: { sourceType: 'CUSTOM', nameZh: '身价验收队', shortName: '验收队' }
    });
    const team = await prisma.leagueTeam.create({
      data: { leagueId, ownerUserId: ownerId, ownerAlias: '验收用户', catalogTeamId: shell.id, teamNumber: 1, name: '身价验收队', shortName: '验收队' }
    });
    teamId = team.id;
    await prisma.seasonEntry.create({
      data: {
        seasonId,
        leagueTeamId: teamId,
        ownerUserId: ownerId,
        source: 'NEW_APPLICATION',
        status: 'APPROVED',
        teamNameSnapshot: team.name,
        teamShortNameSnapshot: team.shortName,
        teamNumberSnapshot: team.teamNumber,
        leagueEditionSnapshot: 'INTERNATIONAL'
      }
    });
    const salaryRule = await prisma.leagueSalaryRuleVersion.create({
      data: {
        leagueId,
        version: 1,
        salaryCapMinor: 10_000,
        effectiveAt: new Date(now - 86_400_000),
        createdByAdminId: adminId,
        tiers: { create: defaultSalaryTiers() }
      }
    });
    const source = await prisma.dataSource.create({
      data: { code: `valuation-e2e-${suffix}`, name: '身价验收数据源' }
    });
    sourceId = source.id;
    const player = await prisma.footballPlayer.create({ data: { nameZh: '身价验收球员' } });
    playerId = player.id;
    const card = await prisma.playerCard.create({
      data: {
        sourceId,
        externalId: `valuation-card-${suffix}`,
        playerId,
        cardName: '身价验收卡',
        position: 'CMF',
        overallRating: 95,
        cardType: 'STANDARD'
      }
    });
    await prisma.leaguePlayerOwnership.create({
      data: {
        leagueId,
        leagueTeamId: teamId,
        footballPlayerId: playerId,
        currentPlayerCardId: card.id,
        dtRatingSnapshot: 95,
        salaryRuleVersionId: salaryRule.id,
        salaryMinor: 400
      }
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { leagueId } });
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId } });
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: [ownerId, outsiderId] } } });
    await prisma.playerValuationHistory.deleteMany({ where: { leagueId } });
    await prisma.leaguePlayerValuation.deleteMany({ where: { leagueId } });
    await prisma.valuationSubmissionItem.deleteMany({ where: { submission: { window: { seasonId } } } });
    await prisma.valuationSubmission.deleteMany({ where: { window: { seasonId } } });
    await prisma.valuationRosterSnapshot.deleteMany({ where: { window: { seasonId } } });
    await prisma.valuationWindow.updateMany({ where: { seasonId }, data: { currentRuleVersionId: null } });
    await prisma.valuationWindowRuleVersion.deleteMany({ where: { window: { seasonId } } });
    await prisma.valuationWindow.deleteMany({ where: { seasonId } });
    await prisma.leaguePlayerOwnership.deleteMany({ where: { leagueId } });
    await prisma.seasonEntry.deleteMany({ where: { seasonId } });
    await prisma.leagueSalaryTier.deleteMany({ where: { salaryRuleVersion: { leagueId } } });
    await prisma.leagueSalaryRuleVersion.deleteMany({ where: { leagueId } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId } });
    await prisma.league.update({ where: { id: leagueId }, data: { currentSeasonId: null } });
    await prisma.leagueSeason.delete({ where: { id: seasonId } });
    await prisma.league.delete({ where: { id: leagueId } });
    const cards = await prisma.playerCard.findMany({ where: { sourceId }, select: { id: true } });
    await prisma.playerCard.deleteMany({ where: { id: { in: cards.map(({ id }) => id) } } });
    await prisma.footballPlayer.delete({ where: { id: playerId } });
    await prisma.dataSource.delete({ where: { id: sourceId } });
    await prisma.adminSession.deleteMany({ where: { adminId } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: [ownerId, outsiderId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await app.close();
    await prisma.$disconnect();
  });

  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const ownerAuth = () => ({ Authorization: `Bearer ${ownerToken}` });

  async function createWindow(name: string, startsOffset: number) {
    const now = Date.now();
    return request(app.getHttpServer()).post(`/v1/admin/seasons/${seasonId}/valuation-windows`)
      .set(adminAuth()).set('Idempotency-Key', randomUUID())
      .send({
        name,
        startsAt: new Date(now + startsOffset).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
        rule: {
          minimumValueMinor: 100,
          maximumValueMinor: 100_000,
          maximumIncreaseBps: 1_000,
          maximumDecreaseBps: 1_000
        }
      }).expect(201);
  }

  it('opens a window, auto-publishes compliant values, and denies a non-owner', async () => {
    const window = await createWindow('首次身价窗口', -2_000);
    const workspace = await request(app.getHttpServer())
      .get(`/v1/me/league-teams/${teamId}/valuations/workspace`).set(ownerAuth()).expect(200);
    expect(workspace.body.window.id).toBe(window.body.id);
    expect(workspace.body.players).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/v1/me/league-teams/${teamId}/valuations/workspace`)
      .set('Authorization', `Bearer ${outsiderToken}`).expect(403);

    const draft = await request(app.getHttpServer())
      .patch(`/v1/me/league-teams/${teamId}/valuations/draft`).set(ownerAuth())
      .send({
        windowId: window.body.id,
        expectedVersion: 1,
        items: [{ snapshotId: workspace.body.players[0].snapshotId, proposedValueMinor: 1_000 }]
      }).expect(200);
    expect(draft.body.status).toBe('DRAFT');

    const published = await request(app.getHttpServer())
      .post(`/v1/me/league-teams/${teamId}/valuations/publish`).set(ownerAuth())
      .set('Idempotency-Key', randomUUID())
      .send({ windowId: window.body.id, expectedVersion: draft.body.version }).expect(201);
    expect(published.body.status).toBe('PUBLISHED');
    await expect(prisma.leaguePlayerValuation.findUniqueOrThrow({
      where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: playerId } }
    })).resolves.toMatchObject({ currentValueMinor: 1_000 });
  });

  it('routes an out-of-range change to review and applies it after approval', async () => {
    const window = await createWindow('复核身价窗口', -1_000);
    const workspace = await request(app.getHttpServer())
      .get(`/v1/me/league-teams/${teamId}/valuations/workspace`).set(ownerAuth()).expect(200);
    expect(workspace.body.window.id).toBe(window.body.id);
    expect(workspace.body.players[0].baseValueMinor).toBe(1_000);

    const draft = await request(app.getHttpServer())
      .patch(`/v1/me/league-teams/${teamId}/valuations/draft`).set(ownerAuth())
      .send({
        windowId: window.body.id,
        expectedVersion: 1,
        items: [{ snapshotId: workspace.body.players[0].snapshotId, proposedValueMinor: 1_500 }]
      }).expect(200);
    const pending = await request(app.getHttpServer())
      .post(`/v1/me/league-teams/${teamId}/valuations/publish`).set(ownerAuth())
      .set('Idempotency-Key', randomUUID())
      .send({ windowId: window.body.id, expectedVersion: draft.body.version }).expect(201);
    expect(pending.body.status).toBe('PENDING_REVIEW');
    await expect(prisma.leaguePlayerValuation.findUniqueOrThrow({
      where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: playerId } }
    })).resolves.toMatchObject({ currentValueMinor: 1_000 });

    const approved = await request(app.getHttpServer())
      .post(`/v1/admin/valuation-submissions/${pending.body.id}/approve`).set(adminAuth())
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: pending.body.version, reason: '确认球员近期表现，批准超限调整' })
      .expect(201);
    expect(approved.body.status).toBe('APPROVED');
    await expect(prisma.leaguePlayerValuation.findUniqueOrThrow({
      where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: playerId } }
    })).resolves.toMatchObject({ currentValueMinor: 1_500 });
  });
});
