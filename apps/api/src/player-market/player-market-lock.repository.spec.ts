import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerMarketLockRepository } from './player-market-lock.repository.js';

config({ path: '../../.env', quiet: true });

describe('PlayerMarketLockRepository database concurrency', () => {
  const prisma = new PrismaService();

  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());

  it('serializes competing approvals with opposite team inputs and deterministic rival application mutation', async () => {
    const suffix = randomUUID();
    const adminId = randomUUID();
    const userIds = [randomUUID(), randomUUID()];
    let leagueId = '';
    let seasonId = '';
    let playerId = '';
    let sourceId = '';
    const catalogIds: string[] = [];
    try {
      await prisma.adminAccount.create({ data: {
        id: adminId, username: `market-lock-${suffix}`, displayName: '市场并发测试',
        passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
      } });
      await Promise.all(userIds.map((id, index) => prisma.user.create({ data: {
        id, wechatOpenId: `market-lock-${suffix}-${index}`, displayName: `市场用户${index + 1}`
      } })));
      const league = await prisma.league.create({ data: {
        name: '市场锁联赛', shortName: '市场锁', defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL', createdByAdminId: adminId
      } });
      leagueId = league.id;
      const season = await prisma.leagueSeason.create({ data: {
        leagueId, seasonNumber: 1, displayName: 'S1', isFirstSeason: true,
        registrationOpensAt: new Date('2026-01-01'), registrationClosesAt: new Date('2026-01-02'),
        startsAt: new Date('2026-01-03'), endsAt: new Date('2027-01-01'), superCapacity: 2,
        championCapacity: 2, promotionCount: 1, status: 'IN_PROGRESS', createdByAdminId: adminId
      } });
      seasonId = season.id;
      const teams = [];
      for (const [index, userId] of userIds.entries()) {
        const catalog = await prisma.teamCatalogItem.create({ data: {
          sourceType: 'CUSTOM', nameZh: `并发队${index + 1}-${suffix}`, shortName: `并发${index + 1}`
        } });
        catalogIds.push(catalog.id);
        teams.push(await prisma.leagueTeam.create({ data: {
          leagueId, ownerUserId: userId, ownerAlias: `用户${index + 1}`, catalogTeamId: catalog.id,
          teamNumber: index + 1, name: `并发队${index + 1}`, shortName: `并发${index + 1}`
        } }));
      }
      const player = await prisma.footballPlayer.create({ data: { nameZh: `并发球员-${suffix}` } });
      playerId = player.id;
      const source = await prisma.dataSource.create({ data: { code: `market-lock-${suffix}`, name: '市场锁源' } });
      sourceId = source.id;
      const card = await prisma.playerCard.create({ data: {
        sourceId, externalId: `card-${suffix}`, playerId, cardName: '并发卡', position: 'CF',
        overallRating: 90, cardType: 'STANDARD'
      } });
      const window = await prisma.transferWindow.create({ data: {
        seasonId, name: '并发窗口', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-12-31'),
        allowBuy: true, allowSell: true, allowTransfer: true, allowCardUpgrade: true, createdByAdminId: adminId
      } });
      const applications = await Promise.all(teams.map((team, index) => prisma.playerAcquisitionApplication.create({ data: {
        leagueId, seasonId, transferWindowId: window.id, type: 'NORMAL_PURCHASE',
        applicantLeagueTeamId: team.id, footballPlayerId: playerId, playerCardId: card.id,
        amountMinor: 500 + index, firstValidSubmittedAt: new Date('2026-06-01'), lastSubmittedAt: new Date('2026-06-01')
      } })));
      const locks = new PlayerMarketLockRepository();
      const approve = (applicationId: string, teamIds: string[]) => prisma.$transaction(async (tx) => {
        await locks.lockSeason(tx, seasonId);
        await locks.lockPlayer(tx, leagueId, playerId);
        await locks.lockTeams(tx, teamIds);
        await locks.lockApplicationsForPlayer(tx, leagueId, seasonId, playerId);
        const current = await tx.playerAcquisitionApplication.findUniqueOrThrow({ where: { id: applicationId } });
        if (current.status !== 'PENDING') return current.status;
        await tx.playerAcquisitionApplication.update({ where: { id: applicationId }, data: { status: 'APPROVED' } });
        await tx.playerAcquisitionApplication.updateMany({
          where: { id: { not: applicationId }, leagueId, seasonId, footballPlayerId: playerId, status: 'PENDING' },
          data: { status: 'NOT_SELECTED' }
        });
        return 'APPROVED';
      }, { isolationLevel: 'ReadCommitted' });

      const outcomes = await Promise.allSettled([
        approve(applications[0]!.id, [teams[1]!.id, teams[0]!.id]),
        approve(applications[1]!.id, [teams[0]!.id, teams[1]!.id])
      ]);

      expect(outcomes.every(({ status }) => status === 'fulfilled')).toBe(true);
      const statuses = await prisma.playerAcquisitionApplication.findMany({
        where: { id: { in: applications.map(({ id }) => id) } }, select: { status: true }
      });
      expect(statuses.map(({ status }) => status).sort()).toEqual(['APPROVED', 'NOT_SELECTED']);
    } finally {
      if (leagueId) {
        await prisma.playerAcquisitionApplicationEvent.deleteMany({ where: { application: { leagueId } } });
        await prisma.playerAcquisitionApplication.deleteMany({ where: { leagueId } });
        await prisma.transferWindow.deleteMany({ where: { season: { leagueId } } });
        await prisma.leagueTeam.deleteMany({ where: { leagueId } });
        await prisma.leagueSeason.deleteMany({ where: { leagueId } });
        await prisma.league.deleteMany({ where: { id: leagueId } });
      }
      if (sourceId) await prisma.playerCard.deleteMany({ where: { sourceId } });
      if (playerId) await prisma.footballPlayer.deleteMany({ where: { id: playerId } });
      if (sourceId) await prisma.dataSource.deleteMany({ where: { id: sourceId } });
      if (catalogIds.length) await prisma.teamCatalogItem.deleteMany({ where: { id: { in: catalogIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.adminAccount.deleteMany({ where: { id: adminId } });
    }
  }, 15_000);
});
