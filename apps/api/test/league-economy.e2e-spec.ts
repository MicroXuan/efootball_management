import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PasswordService } from '../src/admin-auth/password.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { defaultSalaryTiers } from '../src/league-rosters/salary-rules.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('league economy end-to-end flow', () => {
  const prisma = new PrismaService();
  const suffix = randomUUID();
  let app: INestApplication;
  let adminId: string;
  let adminToken: string;
  const userIds: string[] = [];
  const userTokens: string[] = [];
  let leagueId: string;
  let seasonId: string;
  const teamIds: string[] = [];
  let sourceId: string;
  let playerId: string;
  let ownershipId: string;

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    const passwords = app.get(PasswordService);
    const admin = await prisma.adminAccount.create({
      data: {
        username: `economy-e2e-${suffix}`,
        displayName: '经营闭环管理员',
        passwordHash: await passwords.hash('economy-password-123'),
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    adminId = admin.id;
    const adminLogin = await request(app.getHttpServer()).post('/v1/admin/auth/login')
      .send({ username: admin.username, password: 'economy-password-123' }).expect(200);
    adminToken = adminLogin.body.accessToken as string;

    for (const role of ['seller', 'buyer', 'outsider']) {
      const login = await request(app.getHttpServer()).post('/v1/auth/wechat')
        .send({ code: `test-code-economy-${role}-${suffix}` }).expect(200);
      userTokens.push(login.body.accessToken as string);
      const user = await prisma.user.findUniqueOrThrow({
        where: { wechatOpenId: `test-openid-economy-${role}-${suffix}` }
      });
      userIds.push(user.id);
    }

    const league = await prisma.league.create({
      data: {
        name: `经营闭环联赛-${suffix}`,
        shortName: '经营闭环',
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
        displayName: '经营验收赛季',
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

    for (const [index, userId] of userIds.slice(0, 2).entries()) {
      const team = await prisma.leagueTeam.create({
        data: {
          leagueId,
          ownerUserId: userId,
          teamNumber: index + 1,
          name: index === 0 ? '卖方球队' : '买方球队',
          shortName: index === 0 ? '卖方' : '买方',
          shellValueMinor: 5_000
        }
      });
      teamIds.push(team.id);
      await prisma.seasonEntry.create({
        data: {
          seasonId,
          leagueTeamId: team.id,
          ownerUserId: userId,
          source: 'NEW_APPLICATION',
          status: 'APPROVED',
          teamNameSnapshot: team.name,
          teamShortNameSnapshot: team.shortName,
          teamNumberSnapshot: team.teamNumber,
          leagueEditionSnapshot: 'INTERNATIONAL'
        }
      });
    }

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
    await prisma.transferWindow.create({
      data: {
        seasonId,
        name: '经营验收转会窗',
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 3_600_000),
        allowBuy: true,
        allowSell: true,
        allowTransfer: true,
        allowCardUpgrade: true,
        createdByAdminId: adminId
      }
    });
    const source = await prisma.dataSource.create({
      data: { code: `economy-e2e-${suffix}`, name: '经营闭环数据源' }
    });
    sourceId = source.id;
    const player = await prisma.footballPlayer.create({ data: { nameZh: '经营验收球员' } });
    playerId = player.id;
    const card = await prisma.playerCard.create({
      data: {
        sourceId,
        externalId: `economy-card-${suffix}`,
        playerId,
        cardName: '经营验收卡',
        position: 'CF',
        overallRating: 94,
        cardType: 'STANDARD'
      }
    });
    const ownership = await prisma.leaguePlayerOwnership.create({
      data: {
        leagueId,
        leagueTeamId: teamIds[0]!,
        footballPlayerId: playerId,
        currentPlayerCardId: card.id,
        dtRatingSnapshot: 94,
        salaryRuleVersionId: salaryRule.id,
        salaryMinor: 300
      }
    });
    ownershipId = ownership.id;
    await prisma.leaguePlayerValuation.create({
      data: { leagueId, footballPlayerId: playerId, currentValueMinor: 20_000, effectiveAt: new Date() }
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { leagueId } });
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId } });
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.financeLedgerEntry.deleteMany({ where: { leagueId } });
    await prisma.rosterTransaction.deleteMany({ where: { leagueId } });
    await prisma.leagueTransactionFeeRuleVersion.deleteMany({ where: { leagueId } });
    await prisma.leaguePlayerValuation.deleteMany({ where: { leagueId } });
    await prisma.leaguePlayerOwnership.deleteMany({ where: { leagueId } });
    await prisma.transferWindow.deleteMany({ where: { seasonId } });
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
    await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await app.close();
    await prisma.$disconnect();
  });

  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const userAuth = (index: number) => ({ Authorization: `Bearer ${userTokens[index]}` });

  it('preserves valuation through transfer, charges the configured fee, and exposes owner finance', async () => {
    const rule = await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueId}/transaction-fee-rules`).set(adminAuth())
      .set('Idempotency-Key', randomUUID())
      .send({
        rateBps: 500,
        minimumFeeMinor: 500,
        effectiveAt: new Date(Date.now() - 60_000).toISOString(),
        expectedCurrentVersion: 0
      }).expect(201);
    expect(rule.body.version).toBe(1);

    const transferred = await request(app.getHttpServer()).post('/v1/admin/roster/transfers')
      .set(adminAuth()).send({
        seasonId,
        ownershipId,
        targetLeagueTeamId: teamIds[1],
        amountMinor: 30_000,
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        reason: '经营闭环验收转会'
      }).expect(201);
    expect(transferred.body.transaction).toMatchObject({
      valuationSnapshotMinor: 20_000,
      transactionFeeMinor: 1_000
    });
    await expect(prisma.leaguePlayerValuation.findUniqueOrThrow({
      where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: playerId } }
    })).resolves.toMatchObject({ currentValueMinor: 20_000 });

    await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueId}/finance-entries`).set(adminAuth())
      .set('Idempotency-Key', randomUUID())
      .send({
        leagueTeamId: teamIds[1],
        seasonId,
        direction: 'CREDIT',
        type: 'MANUAL_ADJUSTMENT',
        amountMinor: 2_000,
        note: '运营补贴',
        reason: '经营闭环验收人工财务项目'
      }).expect(201);

    const assets = await request(app.getHttpServer())
      .get(`/v1/me/league-teams/${teamIds[1]}/assets`).set(userAuth(1)).expect(200);
    expect(assets.body).toMatchObject({
      teamId: teamIds[1],
      knownPlayerValueMinor: 20_000,
      valuationCompleteness: 'COMPLETE',
      activePlayerCount: 1
    });

    const transactions = await request(app.getHttpServer())
      .get(`/v1/me/leagues/${leagueId}/transactions`).set(userAuth(1)).expect(200);
    expect(transactions.body.items[0]).toMatchObject({
      type: 'TRANSFER',
      playerId,
      transactionFeeMinor: 1_000
    });

    const finance = await request(app.getHttpServer())
      .get(`/v1/me/league-teams/${teamIds[1]}/finance`)
      .set(userAuth(1)).expect(200);
    expect(finance.body).toMatchObject({
      seasonId,
      creditTotalMinor: 2_000,
      debitTotalMinor: 31_000,
      balanceMinor: -29_000
    });
    expect(finance.body.entries.map((entry: { type: string }) => entry.type))
      .toEqual(expect.arrayContaining(['PLAYER_TRANSFER', 'TRANSACTION_FEE', 'MANUAL_ADJUSTMENT']));
  });

  it('keeps participant data read-only and rejects users outside the league', async () => {
    await request(app.getHttpServer())
      .get(`/v1/me/leagues/${leagueId}/transactions`).set(userAuth(2)).expect(403);
    await request(app.getHttpServer())
      .get(`/v1/me/league-teams/${teamIds[1]}/assets`).set(userAuth(0)).expect(403);
    await request(app.getHttpServer())
      .get(`/v1/me/league-teams/${teamIds[1]}/finance?seasonId=${seasonId}`)
      .set(userAuth(0)).expect(403);
  });
});
